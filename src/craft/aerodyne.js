import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchedMaterial } from '../world/materials.js';
import { U } from '../core/uniforms.js';

// The Concord aerodyne "Kestrel": the Meridian civic flyer the visitor pilots. A tilt-duct VTOL
// in the city's materials - bone-white composite with a clear-coat, bronze trim, smoked glass:
//   fuselage  a lofted lifting body (superelliptic sections) whose spine rises into the tail,
//             with a bubble canopy over a two-seat cockpit (pilot, seats, lit instruments)
//   wings     swept, tapered NACA sections with dihedral and wash-out, bronze leading edges,
//             flaperons on hinges, flap-track fairings, tip pods carrying the duct pivots
//   ducts     two tilting wingtip ducted fans (lipped duct, 9 twisted blades, stator vanes,
//             spinner, exhaust ring) that swing from hover to cruise; a pusher fan in the tail
//   tail      a V-tail with ruddervators over the rear duct
//   gear      tricycle gear with oleo struts and tyres that fold into the hull
//   lights    navigation (port red, starboard green, tail white), a breathing red beacon,
//             wingtip strobes (smooth double pulse) and landing lights
// Nose toward -Z, up +Y, starboard +X; units metres. Every solid is closed and outward-wound.

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ geometry --
/** Surface through rings of points (each ring closed); consecutive rings joined, optional caps. */
function loft(rings, { closeRings = false, capStart = false, capEnd = false } = {}) {
  const n = rings[0].length, m = rings.length;
  const pos = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  const idx = [];
  const segJ = closeRings ? m : m - 1;
  for (let j = 0; j < segJ; j++) {
    const j1 = (j + 1) % m;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const a = j * n + i, b = j * n + i1, c = j1 * n + i1, d = j1 * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  const cap = (j, flip) => {
    const c = new THREE.Vector3();
    for (const p of rings[j]) c.add(p);
    c.divideScalar(n);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(m - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g);
  g.computeVertexNormals();
  return g;
}

/** Wind a closed surface outward (positive enclosed volume). */
function orient(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
}

/** Keep only position / normal (+ index) so parts can be merged. */
function clean(g) {
  if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
const merge = (list) => mergeGeometries(list.map(clean), false);

/** Mirror a geometry across x = 0 keeping it outward-wound. */
function mirrorX(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  m.computeVertexNormals();
  return m;
}

/** Ring of a circle of radius r at axial position a (axis +Z), n points. */
const circle = (r, a, n, cx = 0, cy = 0) => { const o = []; for (let i = 0; i < n; i++) { const t = (i / n) * TAU; o.push(V3(cx + Math.cos(t) * r, cy + Math.sin(t) * r, a)); } return o; };

/** A closed solid of revolution about +Z through the profile [[r, a], ...] (open ends capped). */
function revolve(profile, n = 48, { capStart = true, capEnd = true, closed = false } = {}) {
  const rings = profile.map(([r, a]) => circle(Math.max(r, 1e-4), a, n));
  return loft(rings, { closeRings: closed, capStart: !closed && capStart && profile[0][0] > 1e-3, capEnd: !closed && capEnd && profile[profile.length - 1][0] > 1e-3 });
}

/** NACA 4-digit half thickness at chord x (0..1), thickness t, closed trailing edge. */
const nacaT = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x ** 4);
/** Camber line and slope for camber m at p. */
function camber(x, m, p) {
  if (m <= 0) return [0, 0];
  if (x < p) return [(m / (p * p)) * (2 * p * x - x * x), ((2 * m) / (p * p)) * (p - x)];
  return [(m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x), ((2 * m) / ((1 - p) ** 2)) * (p - x)];
}
/**
 * Airfoil loop (chord x 0..1 between c0 and c1, y up) as [x, y] pairs: upper surface from the aft
 * cut forward, lower surface back. A cut away from the ends leaves a flat face; corners are
 * doubled so the normals break there.
 */
function airfoil(k, t, m = 0, p = 0.4, c0 = 0, c1 = 1) {
  const xs = [];
  for (let i = 0; i <= k; i++) { const b = (1 - Math.cos((Math.PI * i) / k)) / 2; xs.push(c0 + (c1 - c0) * b); }
  const up = [], lo = [];
  for (const x of xs) {
    const yt = nacaT(Math.max(x, 0), t), [yc, dy] = camber(x, m, p), th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  const loop = [];
  const aft = c1 < 0.999, fore = c0 > 1e-3;
  if (aft) loop.push(up[up.length - 1]);                            // aft face vertex (doubled corner)
  for (let i = up.length - 1; i >= 0; i--) loop.push(up[i]);
  if (fore) loop.push(up[0], lo[0]);                                // the fore face between doubled corners
  for (let i = fore ? 0 : 1; i < lo.length; i++) loop.push(lo[i]);
  if (aft) loop.push(lo[lo.length - 1]);                            // the ring closes over the aft face
  return loop;
}

/**
 * A lifting surface: stations along span s (local +X) each an airfoil scaled to its chord,
 * leading edge at z, height y, twisted about the quarter chord. `sec(s)` returns
 * { chord, le, y, t, twist }. Returns a closed solid (tip and root capped).
 */
function surface(spanStations, sec, { k = 22, m = 0, p = 0.4, c0 = 0, c1 = 1, tipRound = 0 } = {}) {
  const rings = [];
  for (let si = 0; si < spanStations.length; si++) {
    const s = spanStations[si], S = sec(s);
    let sc = 1;
    if (tipRound > 0 && si >= spanStations.length - 4) sc = Math.max(0.35, 1 - (si - (spanStations.length - 5)) * 0.16);
    const loop = airfoil(k, S.t * sc, m, p, c0, c1);
    const ct = Math.cos(S.twist || 0), st = Math.sin(S.twist || 0);
    rings.push(loop.map(([x, y]) => {
      const u = (x - 0.25) * S.chord, v = y * S.chord;
      return V3(s, S.y + v * ct - u * st, S.le + 0.25 * S.chord + u * ct + v * st);
    }));
  }
  return loft(rings, { capStart: true, capEnd: true });
}

// ----------------------------------------------------------------- the hull --
const L = 15.2, Z0 = -7.6;
const tOf = (z) => (z - Z0) / L;
const hull = (t) => {
  const nose = Math.pow(Math.sin((Math.min(t / 0.42, 1) * Math.PI) / 2), 0.55);
  const w = 1.06 * nose * (1 - 0.72 * Math.pow(smooth(0.5, 1, t), 1.2));
  const topBase = 0.9 * Math.pow(Math.sin((Math.min(t / 0.36, 1) * Math.PI) / 2), 0.6) * (1 - 0.6 * smooth(0.45, 1, t));
  const bot = 0.78 * Math.pow(Math.sin((Math.min(t / 0.3, 1) * Math.PI) / 2), 0.6) * (1 - 0.78 * smooth(0.42, 1, t));
  const cy = -0.06 - 0.05 * (1 - smooth(0, 0.2, t)) + 0.4 * smooth(0.45, 1, t);
  // the cockpit tub: the hull top dips under the canopy (t 0.12 .. 0.44)
  const dip = smooth(0.1, 0.16, t) * (1 - smooth(0.4, 0.47, t));
  const top = topBase * (1 - 0.62 * dip);
  const n = 2.3 + 0.6 * smooth(0.35, 0.9, t);
  return { w, top, topBase, bot, cy, n, dip };
};
const seX = (c, n) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
function hullRing(t, N = 64) {
  const h = hull(t), z = Z0 + L * t, o = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU, c = Math.cos(a), s = Math.sin(a);
    o.push(V3(h.w * seX(c, h.n), h.cy + (s > 0 ? h.top : h.bot) * seX(s, h.n), z));
  }
  return o;
}
/** Hull half-width at height y above station t (0 if above the section). */
function hullHalfWidth(t, y) {
  const h = hull(t), v = y - h.cy, e = v > 0 ? h.top : h.bot;
  if (Math.abs(v) >= e) return 0;
  return h.w * Math.pow(1 - Math.pow(Math.abs(v) / e, h.n), 1 / h.n);
}
/** Height of the hull's underside at station t, x from the centre line. */
function hullBottom(t, x) {
  const h = hull(t), c = Math.pow(Math.min(Math.abs(x) / h.w, 1), h.n / 2), sn = Math.sqrt(Math.max(1 - c * c, 0));
  return h.cy - h.bot * Math.pow(sn, 2 / h.n);
}
export const HULL = { L, Z0, hull, tOf, hullBottom };

// ------------------------------------------------------------------ materials --
function bodyMaterial() {
  return patchedMaterial({ physical: true, color: 0xebe7df, roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.07, envMapIntensity: 1.15 }, {
    key: 'aerodyne-body',
    fragment: {
      pars: /* glsl */ `
float adLine(float x, float P, float w) {
  float fw = max(fwidth(x), 1e-4);
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  return 1.0 - smoothstep(w, w + fw * 1.5, d);
}
float adBand(float x, float a, float b) { float fw = max(fwidth(x), 1e-4); return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x)); }`,
      color: /* glsl */ `
{
  vec3 o = vObjPos;
  // dove-grey belly under a bronze cheat line that sweeps up toward the tail
  float line = -0.16 + 0.035 * o.z;
  float belly = 1.0 - smoothstep(line - 0.02, line + 0.02, o.y);
  float stripe = adBand(o.y, line + 0.035, line + 0.105) * step(abs(o.x), 1.3) * step(-6.6, o.z) * step(o.z, 7.0) * step(0.25, abs(o.x));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.68, 0.71), belly);
  // matte anti-glare panel ahead of the canopy
  float glare = adBand(o.z, -6.35, -5.55) * step(0.18, o.y) * (1.0 - smoothstep(0.34, 0.42, abs(o.x)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.055, 0.06), glare);
  // panel lines: frames every 1.15 m, stringers every 0.9 m, a few rivet rows along the frames
  float pl = max(adLine(o.z + 0.31, 1.15, 0.006), adLine(o.x + 0.45 * sign(o.x), 0.9, 0.005) * step(0.2, abs(o.x)));
  pl = max(pl, adLine(o.y - 0.28, 1.2, 0.005));
  float rivet = adLine(o.z + 0.31 - 0.035, 1.15, 0.004) * adLine(o.y * 1.3 + o.x, 0.09, 0.012);
  diffuseColor.rgb *= 1.0 - 0.34 * pl - 0.2 * rivet;
  vAdStripe = stripe; vAdPanel = pl; vAdGlare = glare;
}`,
      surface: /* glsl */ `
metalnessFactor = mix(metalnessFactor, 1.0, vAdStripe);
roughnessFactor = mix(roughnessFactor, 0.34, vAdStripe);
roughnessFactor = mix(roughnessFactor, 0.8, vAdGlare);
roughnessFactor = clamp(roughnessFactor + 0.25 * vAdPanel, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.42, 0.24), vAdStripe);`,
    },
    onShader: (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('uniform float uTime;', 'uniform float uTime;\nfloat vAdStripe = 0.0; float vAdPanel = 0.0; float vAdGlare = 0.0;');
    },
  });
}

const std = (color, rough, metal, extra = {}) => patchedMaterial({ color, roughness: rough, metalness: metal, ...extra });

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}

function decalTexture(draw, w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------- the craft --
export class Aerodyne {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Aerodyne Kestrel';
    const M = {
      body: bodyMaterial(),
      bronze: std(0xb27c47, 0.3, 1.0, { envMapIntensity: 1.2 }),
      dark: std(0x2a2d31, 0.42, 0.75),
      duct: std(0x3a3e44, 0.5, 0.55),
      rubber: std(0x151515, 0.85, 0.0),
      chrome: std(0xcfd3d8, 0.12, 1.0),
      seat: std(0xd8cbb4, 0.72, 0.0),
      suit: std(0x2f3a48, 0.8, 0.0),
      shell: patchedMaterial({ physical: true, color: 0xebe7df, roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.07, envMapIntensity: 1.15 }, { key: 'aerodyne-shell' }),
      glass: patchedMaterial({ physical: true, color: 0x6f8494, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 2.6, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false }, { key: 'aerodyne-glass' }),
      visor: std(0x151a20, 0.05, 0.9, { envMapIntensity: 2.0 }),
    };
    this.M = M;
    this.lights = [];
    this.movers = { flaperons: [], ruddervators: [], nacelles: [], rotors: [], blur: [], exhaust: [], gear: [] };
    this._build();
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
    this.state = { tilt: 1, rpm: 0.2, gear: 1, roll: 0, pitch: 0, yaw: 0, thrust: 0, lights: 1 };
    this._t = 0;
  }

  _mesh(geo, mat, parent = this.group) { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; }

  _build() {
    const M = this.M, body = [], bronze = [], dark = [];

    // ---- fuselage
    const rings = [];
    const K = 96;
    for (let k = 0; k <= K; k++) { const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / K); rings.push(t < 1e-4 ? hullRing(1e-4).map(() => V3(0, hull(0).cy, Z0)) : hullRing(t)); }
    body.push(loft(rings, { capEnd: true }));

    // ---- canopy (smoked glass bubble) and its bronze frame
    const cr = [], sillL = [], sillR = [];
    const C0 = 0.115, C1 = 0.45, CN = 40;
    for (let k = 0; k <= CN; k++) {
      const u = k / CN, t = lerp(C0, C1, u), h = hull(t), z = Z0 + L * t;
      const ys = h.cy + h.top * 0.82;
      const wc = hullHalfWidth(t, ys) * 0.98 * Math.pow(Math.sin(Math.PI * Math.min(u * 1.04, 1)), 0.35);
      const apex = (h.topBase + 0.42) * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.78)), 0.7) + h.cy;
      const hc = Math.max(apex - ys, 0.001);
      const ring = [];
      for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI; ring.push(V3(Math.cos(a) * Math.max(wc, 0.001), ys + Math.pow(Math.sin(a), 0.85) * hc, z)); }
      ring.push(V3(-wc * 0.9 - 0.001, ys - 0.14, z), V3(wc * 0.9 + 0.001, ys - 0.14, z));
      cr.push(ring);
      if (u > 0.03 && u < 0.97) { sillL.push(V3(-wc - 0.01, ys + 0.01, z)); sillR.push(V3(wc + 0.01, ys + 0.01, z)); }
    }
    this._mesh(loft(cr, { capStart: true, capEnd: true }), M.glass).renderOrder = 2;
    for (const s of [sillL, sillR]) bronze.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s), 60, 0.035, 8, false));
    { // bow frame at the windscreen joint
      const t = lerp(C0, C1, 0.32), h = hull(t), z = Z0 + L * t, ys = h.cy + h.top * 0.82;
      const wc = hullHalfWidth(t, ys) * 0.98 * Math.pow(Math.sin(Math.PI * 0.32), 0.35), apex = (h.topBase + 0.42) * Math.pow(Math.sin(Math.PI * Math.pow(0.32, 0.78)), 0.7) + h.cy;
      const arc = [];
      for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; arc.push(V3(Math.cos(a) * (wc + 0.012), ys + Math.pow(Math.sin(a), 0.85) * (apex - ys) + 0.012, z)); }
      bronze.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 40, 0.03, 8, false));
    }
    this._cockpit();

    // ---- wings: panels with flaperons cut into the outer trailing edge
    const W = { s0: 0.55, s1: 5.4, cr: 3.4, ct: 1.35, sweep: Math.tan((26 * Math.PI) / 180), dih: 0.07, y0: -0.22, le0: -1.25 };
    const wsec = (s) => {
      const f = (s - W.s0) / (W.s1 - W.s0);
      return { chord: lerp(W.cr, W.ct, f), le: W.le0 + (s - W.s0) * W.sweep, y: W.y0 + (s - W.s0) * W.dih, t: lerp(0.14, 0.1, f), twist: -0.045 * f };
    };
    const stations = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(lerp(a, b, i / n)); return o; };
    const FA = 2.9, FB = 5.0, HINGE = 0.74;
    const wingR = [
      surface(stations(W.s0, FA, 14), wsec, { m: 0.02, p: 0.4 }),
      surface(stations(FA, FB, 12), wsec, { m: 0.02, p: 0.4, c1: HINGE }),
      surface(stations(FB, W.s1, 6), wsec, { m: 0.02, p: 0.4 }),
    ];
    for (const g of wingR) { body.push(g); body.push(mirrorX(g)); }
    // bronze leading-edge caps (a thin shell just proud of the nose of the section)
    for (const side of [1, -1]) {
      const pts = stations(W.s0 + 0.5, W.s1 - 0.05, 24).map((s) => { const S = wsec(s); return V3(side * s, S.y + 0.004 * S.chord, S.le + 0.006); });
      bronze.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.026, 8, false));
    }
    // flaperons on their hinge lines
    for (const side of [1, -1]) {
      const a = wsec(FA), b = wsec(FB);
      const pA = V3(side * FA, a.y, a.le + HINGE * a.chord), pB = V3(side * FB, b.y, b.le + HINGE * b.chord);
      const hinge = new THREE.Group();
      hinge.position.copy(pA);
      const axis = pB.clone().sub(pA).normalize();
      hinge.quaternion.setFromUnitVectors(V3(1, 0, 0), axis);
      hinge.userData.q0 = hinge.quaternion.clone();
      let g = surface(stations(FA + 0.03, FB - 0.03, 10), wsec, { m: 0.02, p: 0.4, c0: HINGE + 0.004 });
      if (side < 0) g = mirrorX(g);
      g.applyMatrix4(new THREE.Matrix4().compose(pA, hinge.quaternion, V3(1, 1, 1)).invert());
      this._mesh(g, M.body, hinge);
      this.group.add(hinge);
      this.movers.flaperons.push({ g: hinge, side });
      // flap-track fairings under the hinge line
      for (const s of [FA + 0.35, (FA + FB) / 2, FB - 0.35]) {
        const S = wsec(s), z = S.le + S.chord * 0.62;
        const f = revolve([[0, -0.55], [0.07, -0.4], [0.085, 0], [0.07, 0.35], [0.03, 0.6], [0, 0.66]], 12);
        f.scale(1, 0.9, 1).translate(side * s, S.y - S.chord * S.t * 0.45, z);
        dark.push(f);
      }
    }

    // ---- wingtip pods and the tilting ducted fans
    const tip = wsec(W.s1), zPivot = tip.le + tip.chord * 0.36, yPivot = tip.y;
    for (const side of [1, -1]) {
      const pod = revolve([[0, -1.2], [0.12, -1.05], [0.2, -0.7], [0.22, -0.1], [0.2, 0.5], [0.12, 0.95], [0, 1.15]], 20);
      pod.translate(side * (W.s1 + 0.02), yPivot, zPivot + 0.1);
      body.push(pod);
      // pivot shaft into the duct
      const shaft = new THREE.CylinderGeometry(0.075, 0.075, 0.36, 16); shaft.rotateZ(Math.PI / 2); shaft.translate(side * (W.s1 + 0.17), yPivot, zPivot);
      bronze.push(shaft);
      const nac = this._duct(1.0, side);
      nac.position.set(side * 6.72, yPivot, zPivot);
      this.group.add(nac);
      this.movers.nacelles.push(nac);
      // navigation light on the pod nose, strobe on its tail
      this._light(side > 0 ? 0x33ff66 : 0xff2a1a, V3(side * (W.s1 + 0.02), yPivot, zPivot + 0.1 - 1.17), 'nav', 0.07);
      this._light(0xffffff, V3(side * (W.s1 + 0.02), yPivot, zPivot + 0.1 + 1.12), 'strobe', 0.06);
    }

    // ---- V-tail with ruddervators
    const tz = 4.2;
    const th = hull(tOf(tz + 1.0));
    const tailRoot = V3(0, th.cy + th.topBase * 0.55, tz);
    const T = { s0: 0.05, s1: 2.7, cr: 2.3, ct: 0.95, sweep: Math.tan((38 * Math.PI) / 180) };
    const tsec = (s) => { const f = (s - T.s0) / (T.s1 - T.s0); return { chord: lerp(T.cr, T.ct, f), le: s * T.sweep, y: 0, t: 0.1, twist: 0 }; };
    const TH = 0.7;
    for (const side of [1, -1]) {
      const cant = side * ((42 * Math.PI) / 180);
      const frame = new THREE.Matrix4().compose(tailRoot, new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), cant), V3(1, 1, 1));
      // the fin proper stops at the hinge outboard of the root fillet
      let finFwd = surface(stations(0.55, T.s1 - 0.1, 12), tsec, { c1: TH });
      let finRoot = surface(stations(T.s0, 0.55, 6), tsec, {});
      let finTip = surface(stations(T.s1 - 0.1, T.s1, 3), tsec, { tipRound: 1 });
      for (let g of [finFwd, finRoot, finTip]) {
        if (side < 0) g = mirrorX(g);
        g.applyMatrix4(side < 0 ? new THREE.Matrix4().compose(tailRoot, new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), cant), V3(1, 1, 1)) : frame);
        body.push(g);
      }
      // ruddervator
      const a = tsec(0.58), b = tsec(T.s1 - 0.13);
      const pA = V3(side * 0.58, 0, a.le + TH * a.chord).applyMatrix4(frame), pB = V3(side * (T.s1 - 0.13), 0, b.le + TH * b.chord).applyMatrix4(frame);
      const hinge = new THREE.Group();
      hinge.position.copy(pA);
      hinge.quaternion.setFromUnitVectors(V3(1, 0, 0), pB.clone().sub(pA).normalize());
      hinge.userData.q0 = hinge.quaternion.clone();
      let g = surface(stations(0.58, T.s1 - 0.13, 10), tsec, { c0: TH + 0.006 });
      if (side < 0) g = mirrorX(g);
      g.applyMatrix4(frame);
      g.applyMatrix4(new THREE.Matrix4().compose(pA, hinge.quaternion, V3(1, 1, 1)).invert());
      this._mesh(g, M.body, hinge);
      this.group.add(hinge);
      this.movers.ruddervators.push({ g: hinge, side });
      // registration on the outer face of the fin
      this._finDecal(frame, side, tsec);
    }
    // tail light and rear pusher duct
    const tailT = hull(1), tailC = V3(0, tailT.cy + (tailT.top - tailT.bot) / 2, Z0 + L);
    const rear = this._duct(0.62, 0, true);
    rear.position.set(0, tailC.y, tailC.z + 0.12);
    this.group.add(rear);
    this.rear = rear;
    this._light(0xffffff, V3(0, tailC.y + 0.69, tailC.z + 0.12), 'nav', 0.06);
    // ---- details: pitot, chin sensor, spine antennas, beacons, landing lights, dorsal intake
    { const p = new THREE.CylinderGeometry(0.018, 0.028, 0.9, 10); p.rotateX(Math.PI / 2); p.translate(0.32, -0.05, Z0 + 0.95); M.chrome && dark.push(p); }
    { const h = hull(0.13); const d = new THREE.SphereGeometry(0.19, 24, 16, 0, TAU, Math.PI / 2, Math.PI / 2); d.translate(0, h.cy - h.bot + 0.05, Z0 + L * 0.13); this._mesh(d, M.visor); }
    for (const [z, hgt] of [[1.2, 0.34], [2.8, 0.26]]) {
      const t = tOf(z), h = hull(t), y = h.cy + h.topBase;
      const ant = new THREE.BoxGeometry(0.02, hgt, 0.34); ant.translate(0, hgt / 2, 0); ant.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, 0.55)); ant.translate(0, y - 0.02, z);
      dark.push(ant);
    }
    { const t = tOf(1.9), h = hull(t); this._light(0xff2010, V3(0, h.cy + h.topBase + 0.02, 1.9), 'beacon', 0.09); this._light(0xff2010, V3(0, h.cy - h.bot - 0.03, 0.4), 'beacon', 0.08); }
    { const t = tOf(-5.2), h = hull(t); for (const sx of [-0.26, 0.26]) this._light(0xfff2dc, V3(sx, hullBottom(t, sx) + 0.01, -5.2), 'landing', 0.06); }
    { // dorsal intake scoop feeding the rear fan
      const sc = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16, z = lerp(0.6, 3.4, u), t = tOf(z), h = hull(t), y = h.cy + h.topBase - 0.06;
        const w = 0.34 * Math.sin(Math.PI * Math.min(u * 1.6, 1) * 0.5 + 0.0) * (1 - 0.5 * u), hh = 0.22 * Math.sin(Math.PI * Math.min(u * 1.3, 1) * 0.5) * (1 - 0.8 * u * u);
        const ring = [];
        for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; ring.push(V3(Math.cos(a) * Math.max(w, 0.002), y + Math.sin(a) * Math.max(hh, 0.002), z)); }
        ring.push(V3(-w * 0.9 - 0.002, y - 0.1, z), V3(w * 0.9 + 0.002, y - 0.1, z));
        sc.push(ring);
      }
      body.push(loft(sc, { capStart: true, capEnd: true }));
      const mouth = new THREE.TorusGeometry(0.2, 0.025, 8, 24, Math.PI); mouth.scale(1.4, 1, 1); mouth.translate(0, hull(tOf(0.62)).cy + hull(tOf(0.62)).topBase - 0.06, 0.62);
      bronze.push(mouth);
    }

    // ---- landing gear
    this._gear(V3(0, 0, -4.1), 0.3, 'nose');
    for (const side of [1, -1]) {
      this._gear(V3(side * 1.32, 0, 1.15), 0.36, 'main', side);
      // sponson fairing that takes the folded main leg
      const sp = revolve([[0, -1.25], [0.2, -1.05], [0.36, -0.55], [0.42, 0.1], [0.38, 0.8], [0.22, 1.35], [0, 1.6]], 28);
      sp.scale(1, 0.95, 1).translate(side * 1.32, -0.55, 0.25);
      body.push(sp);
    }

    // ---- emblem on both flanks (the Concord meridian ring)
    this._emblem();

    this._mesh(merge(body), M.body).name = 'Aerodyne hull';
    this._mesh(merge(bronze), M.bronze).name = 'Aerodyne bronze';
    this._mesh(merge(dark), M.dark).name = 'Aerodyne fittings';
  }

  /** A ducted fan whose axis is local +Z (intake -Z, exhaust +Z). Returns its group. */
  _duct(scale, side, fixed = false) {
    const M = this.M, g = new THREE.Group(), s = scale;
    const prof = [[0.9, -0.6], [0.95, -0.665], [1.02, -0.645], [1.062, -0.53], [1.075, -0.2], [1.055, 0.3], [1.0, 0.6], [0.962, 0.625], [0.93, 0.5], [0.9, 0.2], [0.878, -0.2], [0.884, -0.46]].map(([r, a]) => [r * s, a * s]);
    this._mesh(revolve(prof, 72, { closed: true }), M.shell, g);
    // bronze intake lip and dark exhaust liner
    const lip = new THREE.TorusGeometry(0.985 * s, 0.03 * s, 10, 72); lip.translate(0, 0, -0.64 * s);
    this._mesh(lip, M.bronze, g);
    // spinner, stators, motor ring
    const spin = revolve([[0, -0.62], [0.12, -0.55], [0.22, -0.4], [0.27, -0.2], [0.28, 0.3], [0.24, 0.55], [0.12, 0.72], [0, 0.78]].map(([r, a]) => [r * s, a * s]), 36);
    this._mesh(spin, M.bronze, g);
    const stat = [];
    for (let i = 0; i < 7; i++) {
      const b = new THREE.BoxGeometry(0.62 * s, 0.022 * s, 0.26 * s);
      b.translate(0.58 * s, 0, 0.28 * s); b.rotateZ((i / 7) * TAU + 0.2);
      stat.push(b);
    }
    if (!fixed) { // pivot boss on the inboard wall
      const boss = new THREE.CylinderGeometry(0.13, 0.13, 0.16, 16); boss.rotateZ(Math.PI / 2); boss.translate(-side * 1.07 * s, 0, 0); stat.push(boss);
    }
    this._mesh(merge(stat), M.dark, g);
    // the rotor: nine twisted, swept blades
    const rotor = new THREE.Group();
    const blades = [];
    for (let b = 0; b < 9; b++) {
      const phi0 = (b / 9) * TAU, rings = [];
      for (let k = 0; k <= 10; k++) {
        const r = lerp(0.25, 0.86, k / 10) * s, beta = Math.atan(0.34 * s / r), chord = lerp(0.24, 0.15, k / 10) * s, sweep = 0.06 * (k / 10) ** 2;
        const phi = phi0 + sweep;
        const R = V3(Math.cos(phi), Math.sin(phi), 0), Tn = V3(-Math.sin(phi), Math.cos(phi), 0), A = V3(0, 0, 1);
        const loop = airfoil(8, 0.09, 0.03, 0.4);
        rings.push(loop.map(([x, y]) => {
          const u = (x - 0.35) * chord, v = y * chord;
          return R.clone().multiplyScalar(r).addScaledVector(Tn, u * Math.cos(beta) - v * Math.sin(beta)).addScaledVector(A, -0.12 * s + u * Math.sin(beta) + v * Math.cos(beta));
        }));
      }
      blades.push(loft(rings, { capStart: true, capEnd: true }));
    }
    this._mesh(merge(blades), M.duct, rotor);
    g.add(rotor);
    this.movers.rotors.push({ g: rotor, dir: side >= 0 ? 1 : -1 });
    // motion-blur disc (fades in with rpm)
    const blurMat = new THREE.MeshBasicMaterial({ color: 0x1a1d21, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.27 * s, 0.87 * s, 64), blurMat);
    disc.position.z = -0.12 * s; g.add(disc);
    this.movers.blur.push(disc);
    // exhaust glow ring
    const exMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const ex = new THREE.Mesh(new THREE.TorusGeometry(0.86 * s, 0.035 * s, 8, 72), exMat);
    ex.position.z = 0.56 * s; g.add(ex);
    this.movers.exhaust.push(ex);
    return g;
  }

  _cockpit() {
    const M = this.M, seats = [], suit = [], dark = [];
    const seatAt = (z) => {
      const t = tOf(z), h = hull(t), y = h.cy + h.top * 0.72;
      const pan = new THREE.BoxGeometry(0.5, 0.1, 0.5); pan.translate(0, y + 0.05, z);
      const back = new THREE.BoxGeometry(0.5, 0.72, 0.1); back.rotateX(-0.2); back.translate(0, y + 0.42, z + 0.3);
      const head = new THREE.BoxGeometry(0.28, 0.2, 0.08); head.rotateX(-0.2); head.translate(0, y + 0.86, z + 0.39);
      seats.push(pan, back, head);
      return y;
    };
    const y1 = seatAt(-3.95), y2 = seatAt(-2.55);
    // pilot: torso, arms on the stick, helmet with a dark visor
    const torso = new THREE.CapsuleGeometry(0.17, 0.34, 6, 14); torso.rotateX(-0.2); torso.translate(0, y1 + 0.4, -3.8);
    const legs = new THREE.CapsuleGeometry(0.1, 0.5, 4, 10); legs.rotateX(Math.PI / 2 - 0.25); const l2 = legs.clone();
    legs.translate(0.11, y1 + 0.16, -4.25); l2.translate(-0.11, y1 + 0.16, -4.25);
    const arm = new THREE.CapsuleGeometry(0.055, 0.34, 4, 8); arm.rotateX(Math.PI / 2 - 0.6); const a2 = arm.clone();
    arm.translate(0.2, y1 + 0.42, -4.02); a2.translate(-0.2, y1 + 0.42, -4.02);
    suit.push(torso, legs, l2, arm, a2);
    const helmet = new THREE.SphereGeometry(0.15, 24, 18); helmet.translate(0, y1 + 0.78, -3.85);
    const visor = new THREE.SphereGeometry(0.152, 24, 12, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3); visor.rotateY(Math.PI); visor.translate(0, y1 + 0.78, -3.85);
    this._mesh(helmet, M.seat);
    this._mesh(visor, M.visor);
    // instrument coaming and stick
    const coam = new THREE.CylinderGeometry(0.46, 0.46, 0.2, 24, 1, false, Math.PI * 0.15, Math.PI * 0.7); coam.rotateX(Math.PI / 2); coam.rotateZ(Math.PI); coam.scale(1, 0.55, 1); coam.translate(0, y1 + 0.46, -4.72);
    const stick = new THREE.CylinderGeometry(0.018, 0.022, 0.36, 8); stick.translate(0, y1 + 0.2, -4.2);
    dark.push(coam, stick);
    this._mesh(merge(seats), M.seat);
    this._mesh(merge(suit), M.suit);
    this._mesh(merge(dark), M.dark);
    // lit displays (three screens) facing the pilot
    const scr = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, toneMapped: false });
    this.screenMat = scr;
    for (const x of [-0.26, 0, 0.26]) {
      const p = new THREE.PlaneGeometry(0.2, 0.13); p.rotateX(-0.55); p.translate(x, y1 + 0.54, -4.6);
      this._mesh(p, scr);
    }
    void y2;
  }

  _gear(at, rw, kind, side = 0) {
    const M = this.M;
    const G = -2.25;                      // ground contact in the craft frame
    const t = tOf(at.z), h = hull(t);
    const pivotY = kind === 'nose' ? h.cy - h.bot + 0.42 : -0.42;
    const pivot = new THREE.Group();
    pivot.position.set(at.x, pivotY, at.z);
    const wy = G + rw - pivotY;           // wheel centre below the pivot (negative)
    const parts = [], rub = [], br = [];
    const strut = new THREE.CylinderGeometry(0.06, 0.06, -wy * 0.6, 12); strut.translate(0, wy * 0.3, 0);
    const oleo = new THREE.CylinderGeometry(0.042, 0.042, -wy * 0.5, 12); oleo.translate(0, wy * 0.72, 0);
    const fork = new THREE.BoxGeometry(kind === 'nose' ? 0.34 : 0.1, 0.08, 0.12); fork.translate(0, wy + 0.02, 0);
    const link = new THREE.BoxGeometry(0.03, -wy * 0.35, 0.05); link.rotateX(0.35); link.translate(0, wy * 0.55, 0.09);
    parts.push(strut, fork, link); br.push(oleo);
    const wheelsX = kind === 'nose' ? [-0.12, 0.12] : [0];
    for (const wx of wheelsX) {
      const tyre = new THREE.TorusGeometry(rw * 0.72, rw * 0.28, 12, 36); tyre.rotateY(Math.PI / 2); tyre.translate(wx + (kind === 'nose' ? 0 : side * 0.12), wy, 0);
      const hub = new THREE.CylinderGeometry(rw * 0.5, rw * 0.5, 0.14, 24); hub.rotateZ(Math.PI / 2); hub.translate(wx + (kind === 'nose' ? 0 : side * 0.12), wy, 0);
      rub.push(tyre); br.push(hub);
    }
    if (kind === 'nose') { for (const dx of [-0.2, 0.2]) { const door = new THREE.BoxGeometry(0.02, 0.5, 0.9); door.translate(dx, -0.2, 0); parts.push(door); } }
    this._mesh(merge(parts), M.dark, pivot);
    this._mesh(merge(rub), M.rubber, pivot);
    this._mesh(merge(br), M.chrome, pivot);
    this.group.add(pivot);
    this.movers.gear.push({ g: pivot, kind, side });
  }

  _light(color, at, kind, r) {
    const base = new THREE.Color(color);
    const mat = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false });
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
    m.position.copy(at); this.group.add(m);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: (this._glow ||= glowTexture()), color: base.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    halo.position.copy(at); halo.scale.setScalar(kind === 'landing' ? 1.4 : kind === 'beacon' ? 1.6 : 1.1);
    this.group.add(halo);
    this.lights.push({ kind, mat, halo, base, phase: at.x * 0.37 + at.z * 0.11 });
  }

  _finDecal(frame, side, tsec) {
    const tex = (this._regTex ||= decalTexture((x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = '#1d2a38';
      x.font = '600 150px "Helvetica Neue", Helvetica, Arial, sans-serif';
      x.textBaseline = 'middle'; x.textAlign = 'center';
      x.fillText('MC·5026', w / 2, h * 0.42);
      x.fillStyle = '#8a5a2e'; x.font = '500 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
      x.fillText('TERRAN CONCORD · MERIDIAN', w / 2, h * 0.86);
    }));
    const mat = (this._decalMat ||= patchedMaterial({ map: tex, transparent: true, roughness: 0.35, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }, { key: 'aerodyne-decal' }));
    // a strip laid on the fin's outer (local -Y) skin: chord 0.14 .. 0.8, span 0.95 .. 1.75
    const cols = 20, rows = 4, pos = [], uv = [], idx = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const x = lerp(0.14, 0.8, i / cols), s = lerp(0.95, 1.75, j / rows), S = tsec(s);
      const p = V3(side * s, -(nacaT(x, S.t) * S.chord + 0.005), S.le + x * S.chord).applyMatrix4(frame);
      pos.push(p.x, p.y, p.z);
      // read from tail to nose on the starboard fin and nose to tail on the port one, as seen from outside
      uv.push(side > 0 ? 1 - i / cols : i / cols, j / rows);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i; idx.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    this._mesh(g, mat).renderOrder = 3;
  }

  _emblem() {
    const tex = decalTexture((x, w, h) => {
      x.clearRect(0, 0, w, h);
      const c = h / 2;
      x.strokeStyle = '#9a6a38'; x.lineWidth = 16;
      x.beginPath(); x.arc(c, c, c * 0.78, 0, TAU); x.stroke();
      x.lineWidth = 9; x.beginPath(); x.moveTo(c, c * 0.12); x.lineTo(c, h - c * 0.12); x.stroke();
      x.beginPath(); x.ellipse(c, c, c * 0.34, c * 0.78, 0, 0, TAU); x.stroke();
      x.fillStyle = '#1d2a38'; x.font = '600 96px "Helvetica Neue", Helvetica, Arial, sans-serif'; x.textBaseline = 'middle';
      x.fillText('KESTREL', h * 1.08, c);
    }, 1024, 256);
    const mat = patchedMaterial({ map: tex, transparent: true, roughness: 0.3, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }, { key: 'aerodyne-emblem' });
    for (const side of [1, -1]) {
      // follow the hull at the emblem station: a strip of the flank, bent to its curvature
      const z0 = -1.6, z1 = 0.5, yc = 0.08, rows = 6, cols = 16, pos = [], uv = [], idx = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const z = lerp(z0, z1, i / cols), y = yc + lerp(-0.2, 0.2, j / rows), t = tOf(z);
        const x = side * (hullHalfWidth(t, y) + 0.006);
        pos.push(x, y, z); uv.push(side > 0 ? 1 - i / cols : i / cols, j / rows);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 2, d = a + cols + 1;
        if (side > 0) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      this._mesh(g, mat).renderOrder = 3;
    }
  }

  /**
   * Animate from the flight state: tilt (1 hover .. 0 cruise), rpm (0..1), thrust (0..1),
   * gear (1 down .. 0 up), control deflections roll/pitch/yaw (-1..1).
   */
  update(dt, s) {
    this._t += dt;
    const st = this.state;
    const k = (r) => 1 - Math.exp(-dt * r);
    st.tilt += (s.tilt - st.tilt) * k(2.2);
    st.rpm += (s.rpm - st.rpm) * k(1.5);
    st.gear += (s.gear - st.gear) * k(1.4);
    st.roll += (s.roll - st.roll) * k(8);
    st.pitch += (s.pitch - st.pitch) * k(8);
    st.yaw += (s.yaw - st.yaw) * k(8);
    st.thrust += (s.thrust - st.thrust) * k(3);
    const mv = this.movers;
    // nacelles: 0 = axis along the hull (cruise), pi/2 = exhaust straight down (hover)
    for (const n of mv.nacelles) n.rotation.x = st.tilt * (Math.PI / 2) * 0.97;
    // rotors (visual rpm capped so the blades never strobe), blur discs with rpm
    const vis = 2.2 + st.rpm * 3.4;
    for (const r of mv.rotors) r.g.rotation.z += r.dir * vis * TAU * dt;
    for (const d of mv.blur) d.material.opacity = 0.05 + 0.35 * smooth(0.25, 0.9, st.rpm);
    const night = U.uNight.value;
    for (const e of mv.exhaust) { e.material.opacity = 0.15 + 0.85 * st.thrust; e.material.color.setRGB(0.6, 0.85, 1.0).multiplyScalar((0.6 + 2.6 * st.thrust) * lerp(4, 1.1, night)); }
    // flaperons (roll, with droop in hover), ruddervators (pitch + yaw mixed)
    for (const f of mv.flaperons) {
      const a = (-f.side * st.roll * 0.35) + st.tilt * 0.18;
      f.g.quaternion.copy(f.g.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), a));
    }
    for (const r of mv.ruddervators) {
      const a = -st.pitch * 0.3 + r.side * st.yaw * 0.25;
      r.g.quaternion.copy(r.g.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), a));
    }
    // gear folds: the nose leg forward, the mains inboard
    for (const g of mv.gear) {
      const f = 1 - st.gear;
      g.g.rotation.set(g.kind === 'nose' ? -f * 1.62 : f * 1.6, 0, 0);
    }
    // lights: steady navigation, breathing beacon, smooth double-pulse strobes
    const tt = this._t;
    const dayK = lerp(6.5, 1.6, night);
    for (const l of this.lights) {
      let I = 1;
      if (l.kind === 'beacon') I = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(tt * TAU * 0.9 + l.phase), 3);
      else if (l.kind === 'strobe') { const ph = (tt * 0.8 + l.phase) % 1; I = 0.08 + Math.exp(-((ph - 0.1) ** 2) / 0.0006) + 0.8 * Math.exp(-((ph - 0.2) ** 2) / 0.0006); }
      else if (l.kind === 'landing') I = st.gear > 0.5 ? 1 : 0.05;
      l.mat.color.copy(l.base).multiplyScalar(I * dayK * (l.kind === 'landing' ? 1.6 : 1));
      l.halo.material.color.copy(l.base).multiplyScalar(I * dayK * 0.35 * (0.4 + night));
    }
    if (this.screenMat) this.screenMat.color.setRGB(0.37, 0.78, 1.0).multiplyScalar(lerp(1.4, 0.45, night));
  }
}
