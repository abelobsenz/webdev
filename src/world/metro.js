import * as THREE from 'three';
import { WARDS, RIM, GATE } from './layout.js';
import { StreetField, ST, HALF_W, SB, SETBACK, obbOverlap } from './urban.js';
import { patchedMaterial } from './materials.js';
import { createFacadeMaterial } from './facade.js';
import { mulberry32, createNoise2D } from './noise.js';
import { mergeClean, sweepTube, latheFacade } from './geom.js';
import { extrudeAlong, frameAt } from './infrastructure.js';

// Greater Meridian: the Outer Wards. Seven sea districts stand on built platforms in a
// ring 11-17 km out from the Axis, each a whole town (streets, squares, thousands of
// buildings on the same typologies as the lagoon towns) gathered under its own cluster
// of arcologies, and joined to the atoll rim by a bridge carrying a road deck and a
// maglev. The platform is terraced: a battered sea wall, a quay at +3 m, an arcaded
// terrace wall, and the street level at +9 m, whose paving, kerbs, gardens and lamp
// pools are drawn from each ward's own street field (no layered surfaces, so nothing
// z-fights from 15 km away).

const TAU = Math.PI * 2;
export const WARD_TOP = 9;          // street level
const QUAY_Y = 3;                   // quay level
const TOP_F = 0.948;                // street level reaches this fraction of the outline
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** Lobed outline of a ward: radius factor at bearing a (ward frame). */
export function wardShape(w, a) {
  const p = w.seed * 1.7;
  return 1 + 0.055 * Math.sin(3 * a + p) + 0.035 * Math.sin(5 * a + 2.1 * p) + 0.018 * Math.sin(9 * a + 0.7 * p);
}

/** Built ground of the wards (street level or quay) at (x, z), or -Infinity off them. */
export function wardHeight(x, z) {
  for (const w of WARDS) {
    const dx = x - w.x, dz = z - w.z;
    const d = Math.hypot(dx, dz);
    if (d > w.r * 1.2) continue;
    const R = w.r * wardShape(w, Math.atan2(dz, dx));
    if (d < R * TOP_F) return WARD_TOP;
    if (d < R) return QUAY_Y;
  }
  return -Infinity;
}

export function wardAt(x, z) {
  for (const w of WARDS) if (Math.hypot(x - w.x, z - w.z) < w.r * 1.15) return w;
  return null;
}

/** Arcology definitions for the wards (built with the lagoon's towers). */
export function wardTowerDefs() {
  const out = [];
  const pals = ['pearl', 'silver', 'jade', 'bronze', 'rose', 'sand'];
  for (const w of WARDS) {
    w.towers.forEach(([type, a, f, height, radius, extra], i) => {
      const R = w.r * wardShape(w, a) * f;
      out.push({
        type, x: w.x + Math.cos(a) * R, z: w.z + Math.sin(a) * R, height, radius,
        seed: 100 + w.seed * 10 + i, palette: i === 0 ? w.palette : pals[(w.seed + i) % pals.length],
        name: i === 0 ? `${w.name} Crown` : undefined, ward: w.id, ...(extra || {}),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------- bridges --
/**
 * Bridge centrelines (Vector3[] at deck level): from the rim's land (or, for a ward set
 * beyond another, from that ward's edge) arcing 46 m over the sea to the ward's outer
 * esplanade. Computed before the lagoon's town plan so its lots keep clear.
 */
export function wardBridgePaths(ground) {
  const paths = [];
  for (const w of WARDS) {
    const d = Math.hypot(w.x, w.z);
    let sx, sz, sy;
    const link = w.id === 'sunward' ? WARDS.find((q) => q.id === 'tidewater') : null;
    if (link) {
      const a = Math.atan2(w.z - link.z, w.x - link.x);
      const R = link.r * wardShape(link, a) * 0.9;
      sx = link.x + Math.cos(a) * R; sz = link.z + Math.sin(a) * R; sy = WARD_TOP + 0.05;
    } else {
      // the rim bearing nearest the ward's that has land (the Gate channel is water)
      const b0 = Math.atan2(w.z, w.x);
      let best = null;
      for (let k = 0; k <= 40 && !best; k++) {
        for (const sgn of [1, -1]) {
          const b = b0 + sgn * k * 0.01;
          let rl = -1;
          for (let r = RIM.radius - 350; r < RIM.radius + 700; r += 10) if (ground(Math.cos(b) * r, Math.sin(b) * r) > 3.5) rl = r;
          // keep well clear of the Gate's feet
          const px = Math.cos(b) * rl, pz = Math.sin(b) * rl;
          const nearGate = [-1, 1].some((sx) => Math.hypot(px - (GATE.x + sx * GATE.span / 2), pz - GATE.z) < 450);
          if (rl > 0 && !nearGate) { best = { b, r: rl - 70 }; break; }
        }
      }
      if (!best) best = { b: b0, r: RIM.radius };
      sx = Math.cos(best.b) * best.r; sz = Math.sin(best.b) * best.r;
      sy = Math.max(ground(sx, sz), 3.5) + 0.4;
    }
    const a1 = Math.atan2(sz - w.z, sx - w.x);
    const R1 = w.r * wardShape(w, a1) * 0.905;
    const ex = w.x + Math.cos(a1) * R1, ez = w.z + Math.sin(a1) * R1, ey = WARD_TOP + 0.05;
    const L = Math.hypot(ex - sx, ez - sz);
    const N = Math.max(40, Math.ceil(L / 25));
    const path = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const x = sx + (ex - sx) * t, z = sz + (ez - sz) * t;
      let y = sy + (ey - sy) * t + 46 * Math.sin(Math.PI * t) + 3 * ss(0, 0.05, t) * (1 - ss(0.95, 1, t));
      if (t < 0.5) y = Math.max(y, Math.max(ground(x, z), 0) + 0.4 + 6 * ss(0.0, 0.04, t));
      path.push(new THREE.Vector3(x, y, z));
    }
    paths.push({ ward: w.id, path });
  }
  return paths;
}

function buildBridges(paths, ground) {
  const parts = [];
  // road deck with parapets, a lantern rail and a walkway surface (kind 15, v = across)
  const sec = [[-13, 0], [-13.4, 1.2], [-12.6, 1.35], [-12.2, 0.2], [12.2, 0.2], [12.6, 1.35], [13.4, 1.2], [13, 0], [10, -3.4], [-10, -3.4]].reverse();
  const kinds = (i) => (i === 5 ? 15 : (i === 4 || i === 6) ? 2 : 1);
  for (const { path } of paths) {
    parts.push(extrudeAlong(path, sec, kinds));
    const N = path.length - 1;
    // maglev guideway alongside, swinging in near each end
    const tube = path.map((p, i) => {
      const t = i / N;
      const lat = 19 - 6 * (ss(0.06, 0.0, t) + ss(0.94, 1.0, t));
      return p.clone().addScaledVector(frameAt(path, i).side, lat).add(new THREE.Vector3(0, 2.8, 0));
    });
    parts.push(sweepTube(tube, () => 3.0, 12, { kind: 13 }));
    // piers with lotus capitals where the deck flies over the sea
    let acc = 0;
    for (let k = 1; k < N; k++) {
      acc += path[k].distanceTo(path[k - 1]);
      if (acc < 230) continue;
      const p = path[k];
      const base = ground(p.x, p.z);
      if (p.y - Math.max(base, 0) < 14) continue;
      acc = 0;
      const pier = latheFacade([
        { r: 9, y: -22, kind: 1 }, { r: 7, y: 0.5, kind: 1 }, { r: 4.4, y: p.y * 0.55, kind: 1 },
        { r: 6, y: p.y - 7, kind: 1 }, { r: 13, y: p.y - 3.6, kind: 1 },
      ], 16);
      pier.translate(p.x, 0, p.z);
      parts.push(pier);
    }
  }
  return mergeClean(parts);
}

// ---------------------------------------------------------------- platform --
/** One ring strip of the platform: from (f0, y0) to (f1, y1) round the lobed outline. */
function ringStrip(w, f0, y0, f1, y1, kind, seg = 360) {
  const pos = [], fac = [], idx = [];
  const flat = Math.abs(y1 - y0) < 0.01;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    const sh = wardShape(w, a);
    for (const [f, y] of [[f0, y0], [f1, y1]]) {
      const R = w.r * sh * f;
      pos.push(w.x + Math.cos(a) * R, y, w.z + Math.sin(a) * R);
      // u: metres round the ring; v: metres up (walls) or metres in from the edge (flats)
      fac.push(a * w.r * f, flat ? (1 - f) * w.r : y, kind);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orient outward/upward: flip if the first normal points inward (or down)
  const n = g.attributes.normal;
  const px = pos[0] - w.x, pz = pos[2] - w.z;
  const outward = flat ? n.getY(0) > 0 : n.getX(0) * px + n.getZ(0) * pz > 0;
  if (!outward) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function platformGeometry(w) {
  return mergeClean([
    ringStrip(w, 1.018, -14, 1.0, QUAY_Y - 0.4, 1),          // battered sea wall
    ringStrip(w, 1.0, QUAY_Y - 0.4, 1.0, QUAY_Y, 10),         // dark metal fender line
    ringStrip(w, 1.0, QUAY_Y, TOP_F + 0.004, QUAY_Y, 9),      // the quay
    ringStrip(w, TOP_F + 0.004, QUAY_Y, TOP_F + 0.004, WARD_TOP - 1.6, 5),   // arcaded terrace wall
    ringStrip(w, TOP_F + 0.004, WARD_TOP - 1.6, TOP_F + 0.004, WARD_TOP + 1.1, 12),   // glass balustrade
    ringStrip(w, TOP_F + 0.004, WARD_TOP + 1.1, TOP_F - 0.001, WARD_TOP + 1.1, 1),     // coping
    ringStrip(w, TOP_F - 0.001, WARD_TOP + 1.1, TOP_F - 0.001, WARD_TOP, 1),
  ]);
}

function groundGeometry(w) {
  const shape = new THREE.Shape();
  const n = 256;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const R = w.r * wardShape(w, a) * (TOP_F - 0.0005);
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(w.x, WARD_TOP, w.z);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ ground material --
const GROUND_PARS = /* glsl */ `
uniform sampler2D uWField;
uniform vec2 uWC;
uniform float uWHalf;
vec4 wardField(vec2 p) {
  vec2 uv = (p - uWC) / (2.0 * uWHalf) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(1.0, 1.0, 0.0, 0.0);
  return texture2D(uWField, uv);
}
float wGrid(vec2 p, float period, float w, float fw) {
  vec2 d = abs(fract(p / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(w, w + fw * 1.5, min(d.x, d.y));
}
`;
const GROUND_COLOR = /* glsl */ `
{
  vec4 ws = wardField(vWPos.xz);
  float wEdge = ws.r * 32.0 - 16.0;        // signed metres from the kerb (< 0 on the carriageway)
  float wCen = ws.g * 32.0 - 16.0;
  float wSq = smoothstep(0.3, 0.7, ws.b);
  float fw = max(max(fwidth(vWPos.x), fwidth(vWPos.z)), 1e-3);
  float aa = max(fw * 0.7, 0.08);
  float det = 1.0 - smoothstep(0.25, 1.4, fw);          // fine detail only while resolved
  float n1 = vnoise(vWPos.xz * 0.045), n2 = vnoise(vWPos.xz * 0.7);
  // gardens: lawns and planted beds, mottled at two scales
  vec3 garden = mix(vec3(0.085, 0.16, 0.05), vec3(0.19, 0.27, 0.09), n1 * 0.75 + n2 * 0.25 * det);
  // paving: 1.2 m slabs with fine joints, each slab a shade apart
  vec2 slab = floor(vWPos.xz / 1.2);
  float sh = fract(sin(dot(slab, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 pave = vec3(0.64, 0.62, 0.58) * mix(1.0, 0.93 + 0.1 * sh, det);
  pave *= 1.0 - 0.28 * wGrid(vWPos.xz, 1.2, 0.02, fw) * det;
  // carriageway: smooth warm-grey composite, bronze centre inlay
  vec3 road = mix(vec3(0.30, 0.30, 0.31), vec3(0.34, 0.33, 0.33), n2 * det);
  float inlay = (1.0 - smoothstep(0.08, 0.08 + aa, abs(wCen))) * det;
  road = mix(road, vec3(0.62, 0.46, 0.26), inlay * 0.8);
  vec3 kerb = vec3(0.76, 0.74, 0.70);
  float onRoad = 1.0 - smoothstep(-aa, aa, wEdge);
  float onKerb = smoothstep(-aa, aa, wEdge) * (1.0 - smoothstep(0.32 - aa, 0.32 + aa, wEdge));
  float onWalk = smoothstep(0.32 - aa, 0.32 + aa, wEdge) * (1.0 - smoothstep(4.6 - aa, 4.6 + aa, wEdge));
  float paved = max(onWalk, wSq * (1.0 - onRoad));
  vec3 c = garden;
  c = mix(c, pave, paved);
  c = mix(c, kerb, onKerb);
  c = mix(c, road, onRoad);
  diffuseColor.rgb = c;
  wRough = mix(mix(0.95, 0.72, paved), 0.55, onRoad);
  wLamp = ws.a * ws.a;
  wInlay = inlay * onRoad;
}
`;

function groundMaterial(tex, w, half) {
  const uniforms = { uWField: { value: tex }, uWC: { value: new THREE.Vector2(w.x, w.z) }, uWHalf: { value: half } };
  return patchedMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }, {
    key: 'wardGround',
    uniforms,
    fragment: {
      pars: GROUND_PARS + 'float wRough = 0.9; float wLamp = 0.0; float wInlay = 0.0;',
      color: GROUND_COLOR,
      surface: 'roughnessFactor = wRough;',
      emissive: `if (uCityLights > 0.0) {
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.48) * wLamp * uCityLights * 0.9;
        totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * wInlay * uCityLights * 0.06;
      }`,
    },
  });
}

// ------------------------------------------------------------------- plan --
function ringPoly(w, f, step = 8) {
  const pts = [];
  const n = Math.max(48, Math.ceil((TAU * w.r * f) / step));
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * TAU;
    const R = w.r * wardShape(w, a) * f;
    pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  return pts;
}
function radialPoly(w, a, f0, f1, step = 8) {
  const pts = [];
  const sh = wardShape(w, a);
  const n = Math.max(2, Math.ceil(((f1 - f0) * w.r * sh) / step));
  for (let k = 0; k <= n; k++) {
    const f = f0 + ((f1 - f0) * k) / n;
    pts.push([Math.cos(a) * w.r * sh * f, Math.sin(a) * w.r * sh * f]);
  }
  return pts;
}

/**
 * Plan one ward in its local frame: streets drawn into its own StreetField, squares
 * round the arcologies, lots along every frontage (same rules as the lagoon towns).
 */
function planWard(w, towers, rnd, park) {
  const half = w.r * 1.12;
  const field = new StreetField(1024, half, { frame: false });
  const streets = [];      // local polylines
  const squares = [];
  const exclusions = [];
  const add = (pts, cls) => {
    streets.push({ pts, cls, hw: HALF_W[cls] });
    let s0 = 0;
    for (let i = 1; i < pts.length; i++) {
      field.segment(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], HALF_W[cls], s0);
      s0 += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
  };
  // rings: civic ring, two streets, an avenue, and the esplanade along the balustrade
  add(ringPoly(w, 0.2), ST.ESPLANADE);
  add(ringPoly(w, 0.38), ST.STREET);
  add(ringPoly(w, 0.56), ST.AVENUE);
  add(ringPoly(w, 0.74), ST.STREET);
  add(ringPoly(w, 0.905), ST.ESPLANADE);
  // radials: avenues from the civic ring to the esplanade, streets and lanes between
  const nA = Math.max(6, Math.round((TAU * w.r * 0.56) / 620));
  const a0 = w.seed * 0.37;
  for (let k = 0; k < nA; k++) {
    const a = a0 + (k / nA) * TAU, b = a0 + ((k + 0.5) / nA) * TAU;
    add(radialPoly(w, a, 0.2, 0.905), ST.AVENUE);
    add(radialPoly(w, b, 0.38, 0.905), ST.STREET);
    for (const q of [0.25, 0.75]) add(radialPoly(w, a0 + ((k + q) / nA) * TAU, 0.56, 0.905), ST.LANE);
  }
  // squares: the civic heart round the crown tower, and a forecourt round every arcology
  for (const t of towers) {
    const lx = t.def.x - w.x, lz = t.def.z - w.z;
    const r = t.footprint + 16;
    field.square(lx, lz, r);
    squares.push({ x: t.def.x, z: t.def.z, r, kind: 'tower' });
    exclusions.push({ x: lx, z: lz, r: t.footprint + 10 });
  }
  const civicR = Math.max(w.r * 0.14, (towers[0] ? towers[0].footprint : 0) + 26);
  field.square(0, 0, civicR);
  squares.push({ x: w.x, z: w.z, r: civicR, kind: 'civic' });
  exclusions.push({ x: 0, z: 0, r: civicR - 4 });

  // lots along the frontages
  const lots = [];
  const grid = new Map();
  const G = 60;
  const gkey = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  const lotOk = (L) => {
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    for (let iu = -1; iu <= 1; iu += 0.5) for (let iv = -1; iv <= 1; iv += 0.5) {
      const lx = iu * L.w * 0.5, lz = iv * L.d * 0.5;
      const x = L.lx + lx * c + lz * s, z = L.lz - lx * s + lz * c;
      const d = Math.hypot(x, z);
      if (d > w.r * wardShape(w, Math.atan2(z, x)) * (TOP_F - 0.012)) return false;
      if (field.edge(x, z) < SETBACK - 0.6) return false;
      if (field.squareAt(x, z) > 0.02) return false;
    }
    const rad = Math.hypot(L.w, L.d) * 0.5;
    for (const e of exclusions) if (Math.hypot(e.x - L.lx, e.z - L.lz) < e.r + rad) return false;
    const gx = Math.floor(L.lx / G), gz = Math.floor(L.lz / G);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${gx + dx},${gz + dz}`);
      if (list) for (const o of list) if (Math.hypot(o.lx - L.lx, o.lz - L.lz) < rad + Math.hypot(o.w, o.d) * 0.5 + 3 && obbOverlap({ x: o.lx, z: o.lz, w: o.w, d: o.d, rot: o.rot }, { x: L.lx, z: L.lz, w: L.w, d: L.d, rot: L.rot }, 3.2)) return false;
    }
    return true;
  };
  const Rmax = w.r * 0.905;
  for (const cls of [ST.AVENUE, ST.ESPLANADE, ST.STREET, ST.LANE]) {
    for (const st of streets) {
      if (st.cls !== cls) continue;
      const P = st.pts;
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = cum[cum.length - 1];
      const at = (sv) => {
        let i = 1;
        while (i < P.length - 1 && cum[i] < sv) i++;
        const t = (sv - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
        const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
        const tx = P[i][0] - P[i - 1][0], tz = P[i][1] - P[i - 1][1];
        const tl = Math.hypot(tx, tz) || 1;
        return { x, z, tx: tx / tl, tz: tz / tl };
      };
      for (const side of [-1, 1]) {
        let sv = 6 + rnd() * 8;
        while (sv < total - 8) {
          const lane = cls === ST.LANE;
          let wd = lane ? 12 + rnd() * 12 : 18 + rnd() * 24;
          let dep = lane ? 13 + rnd() * 8 : 20 + rnd() * 18;
          let placed = false;
          for (let tryW = 0; tryW < 3 && !placed; tryW++) {
            const p = at(sv + wd / 2);
            const nx = -p.tz * side, nz = p.tx * side;
            const off = st.hw + SB[cls] + dep / 2;
            const L = { lx: p.x + nx * off, lz: p.z + nz * off, w: wd, d: dep, rot: Math.atan2(-nx, -nz), cls };
            if (lotOk(L)) {
              if (park(w.x + L.lx, w.z + L.lz) > 0.6) { placed = true; break; }   // a pocket park here
              L.seed = rnd() * 1000;
              L.centre = Math.max(0, 1 - Math.hypot(L.lx, L.lz) / Rmax);
              lots.push(L);
              const k = gkey(L.lx, L.lz);
              if (!grid.has(k)) grid.set(k, []);
              grid.get(k).push(L);
              placed = true;
            } else { wd *= 0.72; dep *= 0.9; if (wd < 9) break; }
          }
          sv += wd + 3.0 + rnd() * 3.5;
        }
      }
    }
  }
  // lamps along the verges
  const lamps = [];
  for (const st of streets) {
    if (st.cls === ST.LANE) continue;
    const P = st.pts;
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
      const Ls = Math.hypot(dx, dz) || 1;
      acc += Ls;
      if (acc < 34) continue;
      acc = 0;
      const nx = -dz / Ls, nz = dx / Ls;
      for (const side of [-1, 1]) {
        const lx = P[i][0] + nx * side * (st.hw + 1.1), lz = P[i][1] + nz * side * (st.hw + 1.1);
        if (Math.hypot(lx, lz) > Rmax * 1.03) continue;
        field.lamp(lx, lz, 1);
        lamps.push({ x: w.x + lx, z: w.z + lz, yaw: Math.atan2(nx * side, nz * side), cls: st.cls });
      }
    }
  }
  return { field, half, streets, squares, lots, lamps };
}

// ------------------------------------------------------------------- build --
/**
 * Build the Outer Wards. towers = the built ward arcologies (with a measured .footprint).
 * Returns the platforms and bridges, and a plan in world coordinates for buildBuildings
 * and buildStreetscape.
 */
export function buildMetro(scene, towers, bridgePaths, ground) {
  const rnd = mulberry32(5150);
  const nP = createNoise2D(515);
  const park = (x, z) => nP(x * 0.004, z * 0.004) * 0.5 + 0.5;
  const platMat = createFacadeMaterial('pearl', 777, { litFrac: 0.62, band: 1e5, uplight: 1 });
  const out = { meshes: [], wards: [] };
  const plan = { streets: [], squares: [], lots: [], lamps: [], districts: [] };
  for (const w of WARDS) {
    const wt = towers.filter((t) => t.def.ward === w.id).sort((a, b) => (a.def.name ? -1 : 0) - (b.def.name ? -1 : 0));
    const P = planWard(w, wt, rnd, park);
    const tex = P.field.texture();
    const plat = new THREE.Mesh(platformGeometry(w), platMat);
    plat.castShadow = true; plat.receiveShadow = true;
    plat.name = `${w.name} platform`;
    const gnd = new THREE.Mesh(groundGeometry(w), groundMaterial(tex, w, P.half));
    gnd.receiveShadow = true;
    gnd.name = `${w.name} ground`;
    for (const m of [plat, gnd]) { m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); out.meshes.push(m); }
    out.wards.push({ def: w, field: P.field, half: P.half, ground: gnd, platform: plat });
    // into world coordinates for the shared builders
    plan.districts.push({ id: w.id, x: w.x, z: w.z, R: w.r, kind: 'ward' });
    for (const st of P.streets) plan.streets.push({ pts: st.pts.map(([x, z]) => [w.x + x, w.z + z]), cls: st.cls, hw: st.hw, district: w.id });
    plan.squares.push(...P.squares);
    plan.lamps.push(...P.lamps);
    for (const L of P.lots) {
      plan.lots.push({ x: w.x + L.lx, z: w.z + L.lz, w: L.w, d: L.d, rot: L.rot, cls: L.cls, district: w.id, dk: 'ward', seed: L.seed, centre: L.centre, lo: WARD_TOP, hi: WARD_TOP });
    }
  }
  // one field view in world coordinates over every ward (for the streetscape)
  plan.field = {
    edge: (x, z) => { const w = out.wards.find((q) => Math.hypot(x - q.def.x, z - q.def.z) < q.half); return w ? w.field.edge(x - w.def.x, z - w.def.z) : 16; },
    centre: (x, z) => { const w = out.wards.find((q) => Math.hypot(x - q.def.x, z - q.def.z) < q.half); return w ? w.field.centre(x - w.def.x, z - w.def.z) : 16; },
    squareAt: (x, z) => { const w = out.wards.find((q) => Math.hypot(x - q.def.x, z - q.def.z) < q.half); return w ? w.field.squareAt(x - w.def.x, z - w.def.z) : 0; },
  };
  out.plan = plan;
  // bridges and their maglevs
  const bmat = createFacadeMaterial('pearl', 778, { litFrac: 0.6, band: 1e5 });
  const bridges = new THREE.Mesh(buildBridges(bridgePaths, ground), bmat);
  bridges.castShadow = true; bridges.receiveShadow = true;
  bridges.name = 'Ward bridges';
  bridges.matrixAutoUpdate = false; bridges.updateMatrix();
  scene.add(bridges);
  out.meshes.push(bridges);
  out.bridges = bridges;
  return out;
}
