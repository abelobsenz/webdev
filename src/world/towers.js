import * as THREE from 'three';
import { loftSections, latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { mulberry32 } from './noise.js';
import { CROWN_BUILDERS } from './crowns.js';

const TAU = Math.PI * 2;

// --------------------------------------------------------------- helix ----
// Twisted petal-section tower: a rounded k-lobed section rotating as it rises.
// env.drop: how far below the local origin the plinth must reach (lowest ground round the rim).
const helixScale = (v) => {
  let s = (1 + 0.45 * Math.exp(-v * 14)) * (1 - 0.5 * Math.pow(v, 1.6)) * (1 + 0.1 * Math.sin(Math.PI * v * 1.2));
  if (v > 0.86) s *= Math.pow(Math.max(1 - (v - 0.86) / 0.14, 0), 0.55) * 0.9 + 0.1;
  return s;
};
function helixTower(t, rnd, env = {}) {
  const H = t.height, R = t.radius, k = t.petals || 5, twist = (t.twist || 1) * TAU;
  const drop = Math.max(6, env.drop || 6);
  const around = 128;
  const levels = Math.max(80, Math.round(H / 10));
  const a = 0.16 + rnd() * 0.08;
  const section = (v, grow = 0) => {
    const s = helixScale(v), pts = [];
    for (let i = 0; i < around; i++) {
      const th = (i / around) * TAU;
      const r = R * s * (1 + a * Math.cos(k * (th - twist * v))) / (1 + a) + grow;
      pts.push([Math.cos(th) * r, Math.sin(th) * r]);
    }
    return pts;
  };
  const sections = [];
  // the body starts inside the plinth, so its open foot is never seen
  for (let j = 0; j <= levels; j++) {
    const v = j / levels;
    sections.push({ y: v * H * 0.93, pts: section(v), kind: v > 0.84 ? 2 : 0 });
  }
  const parts = [loftSections(sections, { capTop: true, kindTop: 2 })];
  // sky-lobby slabs: closed petal-shaped balcony rings that follow the twist (caps both faces)
  const lobbies = Math.max(3, Math.min(7, Math.round(H / 110)));
  for (let q = 1; q <= lobbies; q++) {
    const v = (q / (lobbies + 1)) * 0.8;
    const y = v * H * 0.93;
    const dv = 1.6 / (H * 0.93);
    parts.push(loftSections([
      { y: y - 1.6, pts: section(v - dv, 2.4), kind: 1 },
      { y: y + 0.2, pts: section(v, 2.4), kind: 1 },
      { y: y + 0.2 + 1e-3, pts: section(v, 2.0), kind: 2 },
      { y: y + 1.4, pts: section(v + dv * 0.8, 2.0), kind: 2 },
    ], { capTop: true, capBottom: true, kindTop: 1 }));
  }
  // needle spire, closed to a point
  parts.push(latheFacade([
    { r: 0, y: H * 0.9, kind: 1 }, { r: R * 0.1, y: H * 0.9, kind: 1 }, { r: R * 0.05, y: H * 0.96, kind: 1 },
    { r: 0.6, y: H * 1.06, kind: 1 }, { r: 0, y: H * 1.065, kind: 1 },
  ], 12));
  // podium: a terraced base on a stepped plinth that reaches the lowest ground round the rim;
  // closed underneath and to the centre on top
  parts.push(latheFacade([
    { r: 0, y: -drop, kind: 1 }, { r: R * 2.85, y: -drop, kind: 1 }, { r: R * 2.85, y: -5, kind: 1 }, { r: R * 2.6, y: -5, kind: 1 },
    { r: R * 2.6, y: 4, kind: 1 }, { r: R * 2.3, y: 6, kind: 3 }, { r: R * 2.0, y: 7, kind: 3 },
    { r: R * 1.9, y: 14, kind: 0 }, { r: R * 1.75, y: 16, kind: 3 }, { r: 0, y: 16.5, kind: 3 },
  ], 64));
  const collide = (y) => {
    if (y < -5) return R * 2.85;
    if (y < 4) return R * 2.6;
    if (y < 7) return R * 2.3;
    if (y < 16.5) return R * 1.95;
    if (y < H * 0.9) return R * helixScale(Math.min(y / (H * 0.93), 1)) * 1.05 + 2.4;
    return 4;
  };
  return { geo: mergeClean(parts), top: H * 1.06, collide };
}

// -------------------------------------------------------------- canopy ----
// Living tree: a flared trunk that branches into cantilevered garden discs.
function canopyTower(t, rnd, env = {}) {
  const H = t.height, R = t.radius;
  const drop = Math.max(6, env.drop || 6);
  const parts = [];
  const trunkTop = H * 0.62;
  const trunkR = (v) => R * (1 + 1.4 * Math.exp(-v * 9) + 0.25 * Math.pow(v, 3)) * (0.85 + 0.15 * Math.cos(v * 20));
  const prof = [];
  for (let j = 0; j <= 40; j++) {
    const v = j / 40;
    prof.push({ r: trunkR(v), y: v * trunkTop, kind: j % 10 === 0 ? 1 : 0 });
  }
  prof.push({ r: R * 0.6, y: trunkTop + 20, kind: 2 });
  prof.push({ r: R * 0.25, y: H * 0.98, kind: 1 });
  prof.push({ r: 0.5, y: H * 1.05, kind: 1 });
  prof.push({ r: 0, y: H * 1.052, kind: 1 });
  parts.push(latheFacade(prof, 64));
  // root plinth: the trunk flare sits in a low planted drum that reaches the lowest ground round the
  // rim; closed underneath, the trunk's open foot is buried inside it
  parts.push(latheFacade([
    { r: 0, y: -drop, kind: 1 }, { r: R * 2.9, y: -drop, kind: 1 }, { r: R * 2.9, y: 3, kind: 1 },
    { r: R * 2.75, y: 4.2, kind: 3 }, { r: R * 2.3, y: 4.6, kind: 3 }, { r: 0, y: 4.6, kind: 3 },
  ], 64));
  // garden discs on branches: placement retried until disc volumes, branches and the spire stay clear
  const discs = [], placed = [];
  const nb = 5 + Math.floor(rnd() * 3);
  const branchPts = (ang, y0, dist, y1) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const rr = dist * Math.pow(u, 0.7);
      const yy = y0 + (y1 - y0) * (u * u * 0.4 + u * 0.6);
      pts.push(new THREE.Vector3(Math.cos(ang) * rr, yy, Math.sin(ang) * rr));
    }
    return pts;
  };
  const inDisc = (p, d, pad) => Math.hypot(p.x - d.x, p.z - d.z) < d.dr + pad && p.y > d.y - 11 && p.y < d.y + 8;
  for (let b = 0; b < nb; b++) {
    let ok = null;
    for (let tr = 0; tr < 14 && !ok; tr++) {
      const ang = (b / nb) * TAU + rnd() * 0.4 + (tr > 6 ? (rnd() - 0.5) * 0.6 : 0);
      const y0 = trunkTop * (0.62 + 0.3 * rnd());
      const dist = R * (3.0 + rnd() * 2.2);
      const y1 = H * (0.6 + 0.35 * rnd());
      // keep the disc rim clear of the trunk / spire
      const dr = Math.min(R * (1.7 + rnd() * 1.1), dist - R * 1.35 - 4);
      if (dr < R * 1.1) continue;
      const d = { ang, x: Math.cos(ang) * dist, y: y1, z: Math.sin(ang) * dist, dr, pts: branchPts(ang, y0, dist, y1) };
      let clash = false;
      for (const o of placed) {
        const hd = Math.hypot(d.x - o.x, d.z - o.z);
        if (hd < d.dr + o.dr + 6 && Math.abs(d.y - o.y) < 30) { clash = true; break; }
        // branches must not pierce the other disc (own disc end excluded)
        if (d.pts.some((p, i) => i < 22 && inDisc(p, o, R * 0.4 + 2)) || o.pts.some((p, i) => i < 22 && inDisc(p, d, R * 0.4 + 2))) { clash = true; break; }
      }
      if (!clash) ok = d;
    }
    if (!ok) continue;
    placed.push(ok);
    const { ang, dr, y: y1, pts } = ok;
    const tube = sweepTube(pts, (u) => R * (0.34 - 0.16 * u), 12, { kind: 1 });
    parts.push(tube);
    // garden disc: lens soffit, glazed rim, parapet with an inner face, flat planted deck at +3.2
    const disc = latheFacade([
      { r: 0, y: -9, kind: 1 }, { r: dr * 0.55, y: -8, kind: 1 }, { r: dr * 0.95, y: -2.5, kind: 0 }, { r: dr, y: 0, kind: 2 },
      { r: dr, y: 2.2, kind: 1 }, { r: dr + 0.3, y: 2.4, kind: 1 }, { r: dr + 0.3, y: 4.4, kind: 1 },
      { r: dr - 0.5, y: 4.4, kind: 1 }, { r: dr - 0.5, y: 3.2, kind: 1 }, { r: dr * 0.9 - 0.5, y: 3.2, kind: 3 }, { r: 0, y: 3.2, kind: 3 },
    ], 48);
    disc.translate(ok.x, y1, ok.z);
    parts.push(disc);
    discs.push({ x: ok.x, y: y1 + 3.2, z: ok.z, r: dr * 0.85 });
  }
  let discLo = Infinity, discHi = -Infinity, discR = 0;
  for (const d of placed) { discLo = Math.min(discLo, d.y - 9); discHi = Math.max(discHi, d.y + 4.4); discR = Math.max(discR, Math.hypot(d.x, d.z) + d.dr + 0.3); }
  const collide = (y) => {
    if (y < 4.6) return R * 2.9;
    if (y > discLo && y < discHi) return discR;
    if (y < trunkTop * 0.25) return trunkR(Math.max(y, 0) / trunkTop) * 1.05;
    if (y < trunkTop) return R * 1.3;
    return R * 0.65;
  };
  return { geo: mergeClean(parts), top: H * 1.05, discs, collide };
}

// ============================================== lens / lattice / shell: shared construction ====
// Hard-edged lathes and lofts whose facade coordinates never shear (u is fixed down each face and
// closes round every ring, v is height), capped struts and boxes with exact normals, podiums that
// meet the ground all round, and a near-detail set (fins, rails, structural nodes) that only the
// camera close by draws (see attachNear).

const RIB = 16;                                  // the facade's rib period: five 3.2 m columns
const snapP = (P) => Math.max(1, Math.round(P / RIB)) * RIB;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Arc-length fractions round a ring of `seg` segments (an sx : sz ellipse) and its unit perimeter. */
function ringFrac(seg, sx = 1, sz = 1) {
  const f = new Float64Array(seg + 1);
  let L = 0;
  for (let i = 1; i <= seg; i++) {
    const a0 = ((i - 1) / seg) * TAU, a1 = (i / seg) * TAU;
    L += Math.hypot((Math.cos(a1) - Math.cos(a0)) * sx, (Math.sin(a1) - Math.sin(a0)) * sz);
    f[i] = L;
  }
  for (let i = 1; i <= seg; i++) f[i] /= L;
  return { f, L };
}

/** The ring angle at arc-length fraction q (0..1) of a ringFrac table. */
function fracAngle(f, q) {
  const seg = f.length - 1;
  let i = 1;
  while (i < seg && f[i] < q) i++;
  const w = (q - f[i - 1]) / Math.max(f[i] - f[i - 1], 1e-9);
  return ((i - 1 + Math.min(Math.max(w, 0), 1)) / seg) * TAU;
}

function makeGeo(pos, nrm, fac, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  if (!nrm) g.computeVertexNormals();
  return g;
}

/**
 * Lathe in hard-edged bands. profile [{ r, y, k, crease, join, vo }] runs bottom to top with the
 * solid on its left (out along the underside, up the outside, in over the top), so every face points
 * out; r = 0 closes a pole. The band from a point to the next has that point's kind k. A band ends
 * where the kind changes, at `crease`, or at a corner sharper than ~25 deg (unless the point says
 * `join`): each band has its own vertices, so kinds never blend and edges stay crisp. Walls get
 * u = arc length (a whole number of rib periods round the ring, so no seam) and v = y + vOff, or
 * y - vo when the band's first point gives vo; flat bands take the plan position, so paving,
 * planting and soffit coffers lie flat. sx / sz make the rings ellipses. Normals are exact.
 */
function latheBands(profile, seg, { sx = 1, sz = 1, vOff = 0 } = {}) {
  const { f: frac, L } = ringFrac(seg, sx, sz);
  const pos = [], nrm = [], fac = [], idx = [];
  const cols = seg + 1;
  const cs = [], sn = [];
  for (let i = 0; i <= seg; i++) { cs.push(Math.cos((i / seg) * TAU)); sn.push(Math.sin((i / seg) * TAU)); }
  const dir = (a, b) => { const dr = b.r - a.r, dy = b.y - a.y, l = Math.hypot(dr, dy); return l > 1e-9 ? [dr / l, dy / l] : [0, 1]; };
  let j0 = 0;
  while (j0 < profile.length - 1) {
    let j1 = j0 + 1;
    while (j1 < profile.length - 1) {
      const p = profile[j1];
      if (p.k !== profile[j0].k || p.crease) break;
      const d0 = dir(profile[j1 - 1], p), d1 = dir(p, profile[j1 + 1]);
      if (!p.join && d0[0] * d1[0] + d0[1] * d1[1] < 0.9) break;
      j1++;
    }
    const pts = profile.slice(j0, j1 + 1);
    let run = 0, rise = 0, rs = 0;
    for (let q = 1; q < pts.length; q++) { run += Math.abs(pts[q].r - pts[q - 1].r); rise += Math.abs(pts[q].y - pts[q - 1].y); }
    for (const p of pts) rs += p.r;
    const flat = rise < 0.35 * run;
    const uP = snapP((rs / pts.length) * L);
    const vo = pts[0].vo !== undefined ? -pts[0].vo : vOff;
    const k = pts[0].k;
    const base = pos.length / 3;
    for (let q = 0; q < pts.length; q++) {
      const p = pts[q];
      const d = dir(pts[Math.max(q - 1, 0)], pts[Math.min(q + 1, pts.length - 1)]);
      const nr = d[1], ny = -d[0];                       // right of the direction of travel
      for (let i = 0; i <= seg; i++) {
        const x = cs[i] * p.r * sx, z = sn[i] * p.r * sz;
        pos.push(x, p.y, z);
        const nx = (nr * cs[i]) / sx, nz = (nr * sn[i]) / sz, l = Math.hypot(nx, ny, nz);
        if (l > 1e-6) nrm.push(nx / l, ny / l, nz / l); else nrm.push(0, 1, 0);
        if (flat) fac.push(x, z, k); else fac.push(frac[i] * uP, p.y + vo, k);
      }
    }
    for (let q = 0; q < pts.length - 1; q++) {
      const lowPole = pts[q].r < 1e-6, highPole = pts[q + 1].r < 1e-6;
      for (let i = 0; i < seg; i++) {
        const a = base + q * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (!lowPole) idx.push(a, c, b);                 // the triangle on a pole ring has no area
        if (!highPole) idx.push(b, c, d);
      }
    }
    j0 = j1;
  }
  return makeGeo(pos, nrm, fac, idx);
}

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3();
/** Capped prism of n sides and radius r from a to b: u round it, v along it (from v0); exact normals. */
function strut(a, b, r, n, kind, v0 = 0) {
  _e3.subVectors(b, a);
  const len = _e3.length();
  _e3.divideScalar(len);
  _e1.set(0, 1, 0);
  if (Math.abs(_e3.y) > 0.9) _e1.set(1, 0, 0);
  _e2.crossVectors(_e3, _e1).normalize();
  _e1.crossVectors(_e2, _e3).normalize();
  const pos = [], nrm = [], fac = [], idx = [];
  for (const [p, v] of [[a, v0], [b, v0 + len]]) {
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * TAU, c = Math.cos(th), s = Math.sin(th);
      const nx = _e1.x * c + _e2.x * s, ny = _e1.y * c + _e2.y * s, nz = _e1.z * c + _e2.z * s;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nrm.push(nx, ny, nz);
      fac.push(th * r, v, kind);
    }
  }
  for (let i = 0; i < n; i++) { const A = i, B = i + 1, C = i + n + 1, D = C + 1; idx.push(A, B, C, B, D, C); }
  // flat end caps
  for (const [p, sgn] of [[a, -1], [b, 1]]) {
    const c0 = pos.length / 3;
    pos.push(p.x, p.y, p.z); nrm.push(_e3.x * sgn, _e3.y * sgn, _e3.z * sgn); fac.push(0, 0, kind);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU, c = Math.cos(th), s = Math.sin(th);
      pos.push(p.x + (_e1.x * c + _e2.x * s) * r, p.y + (_e1.y * c + _e2.y * s) * r, p.z + (_e1.z * c + _e2.z * s) * r);
      nrm.push(_e3.x * sgn, _e3.y * sgn, _e3.z * sgn);
      fac.push(c * r, s * r, kind);
    }
    for (let i = 0; i < n; i++) {
      const P = c0 + 1 + i, Q = c0 + 1 + ((i + 1) % n);
      if (sgn > 0) idx.push(c0, P, Q); else idx.push(c0, Q, P);
    }
  }
  return makeGeo(pos, nrm, fac, idx);
}

/**
 * Box on centre c with unit axes ex, ey, ez and half sizes; flat faces wound outward. Facade u runs
 * along each wall (v = height); up and down faces take the plan position.
 */
function box(c, ex, ey, ez, hx, hy, hz, kind) {
  const pos = [], nrm = [], fac = [], idx = [];
  const ax = [[ex, hx], [ey, hy], [ez, hz]];
  const p = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), X = new THREE.Vector3();
  for (let a = 0; a < 3; a++) {
    const [u, hu] = ax[(a + 1) % 3], [w, hw] = ax[(a + 2) % 3];
    for (const sgn of [1, -1]) {
      N.copy(ax[a][0]).multiplyScalar(sgn);
      const flip = X.crossVectors(u, w).dot(N) < 0;       // corners run anticlockwise seen from outside
      const flat = Math.abs(N.y) > 0.7;
      T.set(-N.z, 0, N.x);
      if (T.lengthSq() < 1e-8) T.set(1, 0, 0); else T.normalize();
      const b0 = pos.length / 3;
      for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        p.copy(c).addScaledVector(N, ax[a][1]).addScaledVector(u, su * hu).addScaledVector(w, sw * hw);
        pos.push(p.x, p.y, p.z);
        nrm.push(N.x, N.y, N.z);
        if (flat) fac.push(p.x, p.z, kind); else fac.push(p.dot(T), p.y, kind);
      }
      if (flip) idx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); else idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  }
  return makeGeo(pos, nrm, fac, idx);
}

/** Horizontal ring tube (radius rr at height y, tube radius rt): u along the ring, v ~ height. */
function hoop(rr, y, rt, radial, tubular, kind) {
  const g = new THREE.TorusGeometry(rr, rt, radial, tubular);
  const uv = g.attributes.uv, n = uv.count;
  const fac = new Float32Array(n * 3);
  const uP = snapP(TAU * rr);
  for (let i = 0; i < n; i++) { fac[i * 3] = uv.getX(i) * uP; fac[i * 3 + 1] = y + (uv.getY(i) - 0.5) * TAU * rt; fac[i * 3 + 2] = kind; }
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Lowest and highest ground (m above the tower base) under the disc of radius r at offset (cx, cz). */
function groundRange(site, r, cx = 0, cz = 0) {
  let lo = Infinity, hi = -Infinity;
  const nr = Math.max(2, Math.ceil(r / 9) + 1);
  for (let q = 0; q < nr; q++) {
    const rr = (r * q) / (nr - 1);
    const na = q === 0 ? 1 : Math.max(8, Math.ceil((TAU * rr) / 8));
    for (let k = 0; k < na; k++) {
      const a = (k / na) * TAU;
      const h = site.at(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return { lo, hi };
}

/**
 * Round podium that meets the ground all round: a stone plinth from below the lowest ground under
 * it to a paved terrace just clear of the highest, a recessed glazed lobby storey under a cornice,
 * and a planted roof the tower rises from. Heights are above the tower base.
 */
function podium(parts, site, rp, { lobby = 9, seg = 72 } = {}) {
  const g = groundRange(site, rp + 3);
  const yb = g.lo - 3, yt = Math.max(g.hi, 1.5) + 1.2, r1 = rp - 5, yr = yt + lobby;
  parts.push(latheBands([
    { r: 0, y: yb, k: 1 }, { r: rp, y: yb, k: 1, vo: yb }, { r: rp, y: yt, k: 9 },
    { r: r1, y: yt, k: 0, vo: yt - 30 }, { r: r1, y: yr, k: 1 }, { r: r1 + 1.8, y: yr, k: 1, vo: yt },
    { r: r1 + 1.8, y: yr + 1.5, k: 3 }, { r: 0, y: yr + 1.5, k: 3 },
  ], seg));
  return { roof: yr + 1.5, terrace: yt, bottom: yb, r: rp };
}

/** A glass balustrade ring (rail height h) standing on a lathe level y at profile radius r. */
function railRing(r, y, h, seg, opts = {}) {
  return latheBands([
    { r: r + 0.08, y: y - 0.1, k: 12, vo: y - 0.1 }, { r: r + 0.08, y: y + h, k: 10, vo: y },
    { r: r - 0.08, y: y + h, k: 12, vo: y - 0.1 }, { r: r - 0.08, y: y - 0.1, k: 12 }, { r: r + 0.08, y: y - 0.1, k: 12 },
  ], seg, opts);
}

// ---------------------------------------------------------------- lens ----
// Stack of elliptical sky-plates turning round a slender core. Each plate is a closed lens: a
// coffered soffit, a glazed rim with fins, a planted parapet, a promenade and a garden on top. The
// glazed core carries six luminous conduits and ends in a lantern and needle; it rises from a
// stone-and-glass podium.
function lensTower(t, rnd, site) {
  const H = t.height, R = t.radius;
  const parts = [], near = [];
  const rot = mulberry32(7000 + t.seed * 31)() * TAU;
  const coreR = (y) => (y < H * 0.5 ? R * (0.24 - 0.04 * (y / (H * 0.5))) : R * (0.2 - 0.06 * ((y - H * 0.5) / (H * 0.47))));
  const rp = R * 0.46;
  const pod = podium(parts, site, rp);
  // the plates: the same sizes, heights and turns as the stack has always had
  const n = Math.max(6, Math.round(H / 95));
  const plates = [], slabs = [], tops = [];
  for (let i = 0; i < n; i++) {
    const v = (i + 0.5) / n;
    const y = 40 + v * (H * 0.9 - 40);
    const r = R * (0.45 + 0.55 * Math.sin(Math.PI * Math.pow(v, 0.75))) * (0.9 + 0.2 * rnd());
    const th = 16 + 18 * (1 - Math.abs(v - 0.5) * 1.6);
    const turn = i * 0.42 + rnd() * 0.1;
    const top = th * 0.5;
    const seg = r > 110 ? 96 : 72;
    const plate = latheBands([
      { r: 0, y: -top, k: 1 }, { r: r * 0.64, y: -top, k: 1 }, { r: r * 0.95, y: -th * 0.19, k: 1 },   // soffit
      { r: r * 0.985, y: -th * 0.14, k: 0 }, { r, y: th * 0.08, k: 0, join: true },                       // glazed rim
      { r: r * 0.99, y: th * 0.36, k: 3 },                                                                 // planted lip
      { r: r * 0.99, y: top + 0.9, k: 1 }, { r: r * 0.978, y: top + 0.9, k: 1 },                          // parapet
      { r: r * 0.978, y: top, k: 9 }, { r: r * 0.9, y: top, k: 3 }, { r: 0, y: top, k: 3 },              // promenade, garden
    ], seg, { sz: 0.62, vOff: 30 });
    plate.rotateY(turn).translate(0, y, 0);
    parts.push(plate);
    // near: a fin on every rib of the glazed rim, and a glass balustrade on the parapet
    const dp = [railRing(r * 0.984, top + 0.9, 1.1, seg, { sz: 0.62 })];
    const { f, L } = ringFrac(seg, 1, 0.62);
    const uP = snapP(((0.985 + 1 + 0.99) / 3) * r * L);
    const up = V3(0, 1, 0);
    for (let u = RIB * 0.1; u < uP; u += RIB) {
      const a = fracAngle(f, u / uP);
      const P = V3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.62);
      const nx = V3(Math.cos(a), 0, Math.sin(a) / 0.62).normalize();
      const nz = V3().crossVectors(nx, up);
      const din = 0.025 * r;
      dp.push(box(P.addScaledVector(nx, (0.9 - din) / 2).setY(th * 0.11), nx, up, nz, (0.9 + din) / 2, th * 0.23, 0.3, 1));
    }
    const dg = mergeClean(dp).rotateY(turn).translate(0, y, 0);
    near.push({ geo: dg, y });
    plates.push({ y: y + top, r: r * 0.6 });
    slabs.push({ y0: y - top, y1: y + top + 2, r: r + 1 });
    tops.push(y + top);
  }
  // the core: glazed storeys between the plates (each run starts over the plate below it, so its
  // hanging garden sits on the plate's garden), six luminous conduits, a lantern and a needle
  const yc = H * 0.955, cr = coreR(yc);
  const ys = [pod.roof - 1.5, ...tops.filter((y) => y > pod.roof && y < yc - 20), H * 0.5].sort((a, b) => a - b);
  const prof = [{ r: 0, y: pod.roof - 1.5, k: 1 }];
  for (const y of ys) {
    const isTop = tops.includes(y) || y === pod.roof - 1.5;
    prof.push({ r: coreR(y), y, k: 0, crease: isTop, join: !isTop, vo: isTop ? Math.max(y, pod.roof) : undefined });
  }
  prof.push(
    { r: cr, y: yc, k: 1 }, { r: cr + 2.4, y: yc, k: 1 }, { r: cr + 2.4, y: yc + 2.4, k: 1 },             // cornice
    { r: cr * 0.92, y: yc + 2.4, k: 2 }, { r: cr * 0.92, y: H * 0.985, k: 1 },                            // lantern
    { r: 1.4, y: H * 1.01, k: 1, crease: true }, { r: 0, y: H * 1.04, k: 1 },                            // roof, needle
  );
  parts.push(latheBands(prof, 48));
  // the conduits run from inside the podium to inside the cornice, following the core's taper
  for (let m = 0; m < 6; m++) {
    const a = ((m + 0.5) / 6) * TAU, er = V3(Math.cos(a), 0, Math.sin(a));
    for (const [y0, y1] of [[pod.roof - 1, H * 0.5 + 1], [H * 0.5 - 1, yc + 1.2]]) {
      const b0 = er.clone().multiplyScalar(coreR(y0) + 0.65).setY(y0), b1 = er.clone().multiplyScalar(coreR(Math.min(y1, yc)) + 0.65).setY(y1);
      const ey = V3().subVectors(b1, b0), len = ey.length();
      ey.divideScalar(len);
      const ex = er.clone().addScaledVector(ey, -er.dot(ey)).normalize(), ez = V3().crossVectors(ex, ey);
      parts.push(box(b0.clone().add(b1).multiplyScalar(0.5), ex, ey, ez, 1.15, len / 2, 2, 4));
    }
  }
  const collide = (y) => {
    let r = y < pod.roof ? rp : coreR(Math.min(Math.max(y, 0), yc)) + 3;
    for (const s of slabs) if (y > s.y0 - 2 && y < s.y1 + 2) r = Math.max(r, s.r);
    return r;
  };
  return { geo: mergeClean(parts), top: H * 1.04, plates, collide, rot, near };
}

// ------------------------------------------------------------- lattice ----
// Hyperboloid diagrid (a doubly ruled surface of straight struts) round an occupied core. The
// struts stand in footings on the ground, cross at structural nodes, are tied by hoops at every
// tier of crossings and end in a crown ring; floor plates (sky terraces) reach from the core to
// just inside the lattice at every tier.
function latticeTower(t, rnd, site) {
  const H = t.height, R = t.radius;
  const parts = [], near = [];
  const rot = mulberry32(7000 + t.seed * 31)() * TAU;
  const cR = Math.cos(rot), sR = Math.sin(rot);
  const N = 28, rb = R, rt = R * 0.55, tw = THREE.MathUtils.degToRad(95), y1 = H * 0.9;
  const cw = Math.cos(tw), sw = Math.sin(tw);
  // one family's ruling at height fraction u: its radius and how far round it has turned
  const lineAt = (u) => { const ax = rb + (cw * rt - rb) * u, az = sw * rt * u; return { r: Math.hypot(ax, az), phi: Math.atan2(az, ax) }; };
  // struts i and i + k of the two families cross where each has turned pi k / N: tiers of nodes
  const tiers = [];
  for (let k = 1; k <= N / 2; k++) {
    const target = (Math.PI * k) / N;
    if (lineAt(1).phi <= target) break;
    let lo = 0, hi = 1;
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (lineAt(m).phi < target) lo = m; else hi = m; }
    tiers.push({ k, u: 0.5 * (lo + hi) });
  }
  const coreR = (y) => R * (0.34 - 0.12 * Math.min(Math.max(y, 0) / (H * 0.93), 1));
  const pod = podium(parts, site, R * 0.34 + 12);
  // struts: each pair from a footing on the ground (the site may fall away) to the crown ring
  const slope = Math.hypot(cw * rt - rb, sw * rt) / y1;           // horizontal run per metre of rise
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const fx = Math.cos(a0) * rb, fz = Math.sin(a0) * rb;
    const g = groundRange(site, 6.5, fx * cR + fz * sR, -fx * sR + fz * cR);
    const yf = g.hi + 0.8, rf = Math.max(4.6, Math.abs(yf) * slope + 2.8);
    parts.push(latheBands([
      { r: 0, y: g.lo - 1.5, k: 1 }, { r: rf + 0.7, y: g.lo - 1.5, k: 1, vo: g.lo - 1.5 },
      { r: rf + 0.7, y: yf - 0.7, k: 1 }, { r: rf, y: yf, k: 1 }, { r: 0, y: yf, k: 1 },
    ], 20).translate(fx, 0, fz));
    for (const fam of [-1, 1]) {
      const p0 = V3(fx, 0, fz), p1 = V3(Math.cos(a0 + fam * tw) * rt, y1, Math.sin(a0 + fam * tw) * rt);
      const a = p0.clone().lerp(p1, (yf - 0.6) / y1);
      parts.push(strut(a, p1, 1.6, 8, 1, a.y));
    }
  }
  // hoops through every tier of nodes (and between the tall lower tiers), the crown ring on top
  const hoopY = [];
  let prev = 0;
  for (const T of tiers) {
    const y = T.u * y1, m = Math.floor((y - prev) / 75);
    for (let j = 1; j <= m; j++) hoopY.push(prev + ((y - prev) * j) / (m + 1));
    hoopY.push(y);
    prev = y;
  }
  for (const y of hoopY) { if (y > pod.roof + 8) parts.push(hoop(lineAt(y / y1).r, y, 1.3, 6, 96, 2)); }
  parts.push(hoop(rt, y1, 2.4, 8, 96, 1));
  // structural nodes where the struts cross (near detail)
  for (const T of tiers) {
    const y = T.u * y1, r = lineAt(T.u).r, phi = (Math.PI * T.k) / N;
    const ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + phi, d = V3(Math.cos(a), 0, Math.sin(a));
      ring.push(strut(d.clone().multiplyScalar(r - 2).setY(y), d.clone().multiplyScalar(r + 2).setY(y), 2.7, 8, 1, 0));
    }
    near.push({ geo: mergeClean(ring), y });
  }
  // floor plates at the tiers and the crown: coffered soffit, fascia, paved edge, garden
  const tops = [];
  // (each plate's edge is carried in its hoop and the struts; the rail stands clear inside them)
  for (const [u, rl] of [...tiers.map((T) => [T.u, lineAt(T.u).r]), [1, rt]]) {
    const y = u * y1, yb = y - 1.8, yt = y + 1.2, ro = rl - 1;
    parts.push(latheBands([
      { r: 0, y: yb, k: 1 }, { r: ro, y: yb, k: 1, vo: yb }, { r: ro, y: yt, k: 9 }, { r: ro - 5, y: yt, k: 3 }, { r: 0, y: yt, k: 3 },
    ], 72));
    near.push({ geo: railRing(rl - 3, yt, 1.1, 72), y: yt });
    tops.push(yt);
  }
  // the occupied core: glazed storeys in runs from plate to plate, then a cornice, a lantern, a
  // domed roof and the needle
  const yc = H * 0.93, cr = coreR(yc);
  const prof = [{ r: 0, y: pod.roof - 1.5, k: 1 }, { r: coreR(pod.roof - 1.5), y: pod.roof - 1.5, k: 0, vo: pod.roof }];
  for (const y of tops) if (y < yc - 10) prof.push({ r: coreR(y), y, k: 0, crease: true, vo: y });
  prof.push(
    { r: cr, y: yc, k: 1 }, { r: cr + 1.5, y: yc, k: 1 }, { r: cr + 1.5, y: yc + 2.2, k: 1 },
    { r: cr * 1.12, y: yc + 2.2, k: 2 }, { r: cr * 1.12, y: H * 0.965, k: 1 },
    { r: cr * 0.5, y: H * 0.995, k: 1 }, { r: 1.2, y: H * 1.0, k: 1, crease: true }, { r: 0, y: H * 1.02, k: 1 },
  );
  parts.push(latheBands(prof, 48));
  const collide = (y) => (y < 20 ? R + 6 : y <= y1 + 3 ? lineAt(Math.min(y / y1, 1)).r + 3.5 : y < H * 0.97 ? cr * 1.12 + 2 : 2);
  return { geo: mergeClean(parts), top: H * 1.02, collide, rot, near };
}

// --------------------------------------------------------------- shell ----
// The nautilus: a thick logarithmic-spiral wall (1.4 turns, rounded at both ends: the lip outside,
// the eye within) that tapers and turns as it rises. The spiral canyon between the whorls and the
// chamber at its heart are open courts, floored by the podium; the walls step back at sky-garden
// ledges between tiers, and a lantern crown on the axis roofs the heart and carries the spire.
let SHELL_PLAN = null;
function shellPlan() {
  if (SHELL_PLAN) return SHELL_PLAN;
  const turns = 1.4, g = 2.0, w0 = 0.14, w1 = 0.1, capN = 6;
  const k = Math.log(g) / TAU, Phi = turns * TAU, rho0 = Math.pow(g, -turns);
  const frame = (f) => {
    const r = rho0 * Math.exp(k * f);
    let tx = k * Math.cos(f) - Math.sin(f), tz = k * Math.sin(f) + Math.cos(f);
    const l = Math.hypot(tx, tz);
    tx /= l; tz /= l;
    return { cx: Math.cos(f) * r, cz: Math.sin(f) * r, tx, tz, nx: tz, nz: -tx, w: (w0 + w1 * r) / 2 };
  };
  const n = Math.round((turns * 360) / 6.5);
  const outer = [], lip = [], inner = [], eye = [];
  for (let i = 0; i <= n; i++) { const F = frame((i / n) * Phi); outer.push([F.cx + F.nx * F.w, F.cz + F.nz * F.w]); }
  {
    const F = frame(Phi);
    for (let q = 1; q < capN; q++) { const b = (q / capN) * Math.PI; lip.push([F.cx + (F.nx * Math.cos(b) + F.tx * Math.sin(b)) * F.w, F.cz + (F.nz * Math.cos(b) + F.tz * Math.sin(b)) * F.w]); }
  }
  for (let i = n; i >= 0; i--) { const F = frame((i / n) * Phi); inner.push([F.cx - F.nx * F.w, F.cz - F.nz * F.w]); }
  {
    const F = frame(0);
    for (let q = 1; q < capN; q++) { const b = (q / capN) * Math.PI; eye.push([F.cx - (F.nx * Math.cos(b) + F.tx * Math.sin(b)) * F.w, F.cz - (F.nz * Math.cos(b) + F.tz * Math.sin(b)) * F.w]); }
  }
  const pts = [...outer, ...lip, ...inner, ...eye];
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.hypot(p[0], p[1]));
  for (const p of pts) { p[0] /= m; p[1] /= m; }
  const M = pts.length, nO = outer.length, nL = lip.length, nI = inner.length;
  const span = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i % M); return out; };
  const faces = [
    { idx: span(0, nO - 1), k: 0 },                          // the outer face of the whorls
    { idx: span(nO - 1, nO + nL), k: 1 },                    // the lip
    { idx: span(nO + nL, nO + nL + nI - 1), k: 0 },          // the inner face, on the canyon
    { idx: span(nO + nL + nI - 1, M), k: 1 },                // the eye
  ];
  for (const F of faces) {
    F.len = [0];
    for (let q = 1; q < F.idx.length; q++) { const a = pts[F.idx[q - 1]], b = pts[F.idx[q]]; F.len.push(F.len[q - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  }
  // outward normals of the plan at each point (for the ledge rails)
  const nrm = pts.map((p, i) => {
    const a = pts[(i - 1 + M) % M], b = pts[(i + 1) % M];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dz / l, -dx / l];
  });
  SHELL_PLAN = { pts, faces, nrm };
  return SHELL_PLAN;
}

function shellTower(t, rnd, site) {
  const H = t.height, R = t.radius;
  const parts = [], near = [];
  const rot = mulberry32(7000 + t.seed * 31)() * TAU;
  const plan = shellPlan(), P = plan.pts, M = P.length;
  const sOf = (y) => { const v = Math.max(y, 0) / (H * 0.96); return (1 - 0.72 * Math.pow(v, 1.3)) * (1 + 0.3 * Math.exp(-v * 10)); };
  const turnOf = (y) => (Math.max(y, 0) / (H * 0.96)) * Math.PI * 0.85 + (t.seed || 0);
  const yTop = H * 0.9;
  // the podium: a plinth under the whole plan, its top the floor of the canyon and the heart
  const rp = 1.3 * R + 3;
  const gr = groundRange(site, rp + 3);
  const yb = gr.lo - 3, yP = Math.max(gr.hi, 1.5) + 1.0;
  parts.push(latheBands([
    { r: 0, y: yb, k: 1 }, { r: rp, y: yb, k: 1, vo: yb }, { r: rp, y: yP, k: 9 }, { r: rp - 6, y: yP, k: 3 }, { r: 0, y: yP, k: 3 },
  ], 96));
  // tiers: equal steps of the taper, each a little inside the one below (a 2.5 m ledge at the lip)
  const K = Math.max(4, Math.round(H / 190));
  const s0 = sOf(yP), s1 = sOf(yTop);
  const bounds = [yP - 1];
  for (let k = 1; k < K; k++) {
    const target = s0 * Math.pow(s1 / s0, k / K);
    let lo = yP, hi = yTop;
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (sOf(m) > target) lo = m; else hi = m; }
    bounds.push(0.5 * (lo + hi));
  }
  bounds.push(yTop);
  const scale = [1];
  for (let k = 1; k < K; k++) scale.push(scale[k - 1] * (1 - 2.5 / (sOf(bounds[k]) * scale[k - 1] * R)));
  const place = (y, s, a) => { const c = Math.cos(a), sn = Math.sin(a); return P.map(([x, z]) => [(x * c - z * sn) * s, (x * sn + z * c) * s]); };
  for (let k = 0; k < K; k++) {
    const ya = bounds[k], yz = bounds[k + 1], c = scale[k];
    const nRows = Math.max(3, Math.ceil((yz - ya) / 15));
    const rows = [];
    for (let j = 0; j <= nRows; j++) { const y = ya + ((yz - ya) * j) / nRows; rows.push({ y, s: sOf(y) * c * R, a: turnOf(y) }); }
    const uS = sOf(0.5 * (ya + yz)) * c * R;
    const v0 = k === 0 ? yP - 12 : ya;          // a hanging garden over every ledge; a clear lobby storey
    for (const F of plan.faces) {
      const pos = [], fac = [], idx = [];
      const m = F.idx.length;
      for (const row of rows) {
        const cs = Math.cos(row.a), sn = Math.sin(row.a);
        for (let q = 0; q < m; q++) {
          const [x, z] = P[F.idx[q]];
          pos.push((x * cs - z * sn) * row.s, row.y, (x * sn + z * cs) * row.s);
          fac.push(F.len[q] * uS, row.y - v0, F.k);
        }
      }
      for (let j = 0; j < rows.length - 1; j++) {
        for (let q = 0; q < m - 1; q++) { const a = j * m + q, b = a + 1, cc = a + m, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
      }
      parts.push(makeGeo(pos, null, fac, idx));
    }
    if (k < K - 1) {
      // the ledge between this tier and the next: planted on top where the tier above steps in,
      // a soffit underneath where it steps out over the canyon (the other copy is inside a tier)
      const y = yz, a = turnOf(y);
      const L = place(y, sOf(y) * c * R, a), U = place(y, sOf(y) * scale[k + 1] * R, a);
      const pos = [], nrm = [], fac = [], idx = [];
      for (const [upward, kind] of [[true, 3], [false, 1]]) {
        const b = pos.length / 3;
        for (const Q of [L, U]) for (const [x, z] of Q) { pos.push(x, y, z); nrm.push(0, upward ? 1 : -1, 0); fac.push(x, z, kind); }
        for (let i = 0; i < M; i++) {
          const i1 = (i + 1) % M;
          const A = b + i, B = b + i1, C = b + M + i1, D = b + M + i;
          const [ax, az] = L[i], [bx, bz] = L[i1], [cx, cz] = U[i1];
          const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
          if ((ny > 0) === upward) idx.push(A, B, C, A, C, D); else idx.push(A, C, B, A, D, C);
        }
      }
      parts.push(makeGeo(pos, nrm, fac, idx));
      // a glass balustrade round the ledge's edge (hidden inside the tier above where it overhangs)
      near.push({ geo: shellRail(L, plan.nrm, a, y), y });
    }
  }
  // the roof: a garden over the last tier
  {
    const y = yTop, S = place(y, sOf(y) * scale[K - 1] * R, turnOf(y));
    const tris = THREE.ShapeUtils.triangulateShape(S.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const pos = [], nrm = [], fac = [], idx = [];
    for (const [x, z] of S) { pos.push(x, y, z); nrm.push(0, 1, 0); fac.push(x, z, 3); }
    for (const [a, b, c] of tris) {
      const ny = (S[b][1] - S[a][1]) * (S[c][0] - S[a][0]) - (S[b][0] - S[a][0]) * (S[c][1] - S[a][1]);
      if (ny > 0) idx.push(a, b, c); else idx.push(a, c, b);
    }
    parts.push(makeGeo(pos, nrm, fac, idx));
  }
  // the crown: a drum on the axis over the heart of the spiral, a lantern, a cornice and the spire
  const env = sOf(yTop) * scale[K - 1] * R;
  const rC = env * 0.6, yC = H * 0.95;
  parts.push(latheBands([
    { r: 0, y: yTop - 1.5, k: 1 }, { r: rC, y: yTop - 1.5, k: 1 }, { r: rC, y: yTop + 4, k: 1 },
    { r: rC - 1.2, y: yTop + 4, k: 2 }, { r: rC - 1.2, y: yC, k: 1 }, { r: rC + 0.6, y: yC, k: 1 },
    { r: rC + 0.6, y: yC + 2.5, k: 1 }, { r: rC * 0.35, y: H * 0.995, k: 1 },
    { r: 1.2, y: H * 1.0, k: 1, crease: true }, { r: 0, y: H * 1.08, k: 1 },
  ], 64, { vOff: -yTop }));
  const collide = (y) => {
    if (y < yP + 2) return rp;
    if (y > yTop) return rC + 2;
    let k = 0;
    while (k < K - 1 && y > bounds[k + 1]) k++;
    return sOf(y) * scale[k] * R + 3;
  };
  return { geo: mergeClean(parts), top: H * 1.08, collide, rot, near };
}

/** Balustrade round a ledge ring L (plan points, their unit outward normals turned by a) at height y. */
function shellRail(L, nrm0, a, y) {
  const M = L.length, c = Math.cos(a), sn = Math.sin(a);
  const pos = [], nrm = [], fac = [], idx = [];
  const inset = 0.45, half = 0.07, h = 1.1;
  let u = 0;
  const us = [0];
  for (let i = 1; i <= M; i++) { u += Math.hypot(L[i % M][0] - L[i - 1][0], L[i % M][1] - L[i - 1][1]); us.push(u); }
  // outer face, top, inner face: separate strips so the edges stay crisp
  const strips = [
    { off: inset - half, y0: y - 0.1, y1: y + h, sgn: 1, k: 12 },
    { off: inset + half, y0: y + h, y1: y - 0.1, sgn: -1, k: 12 },
  ];
  for (const S of strips) {
    const b = pos.length / 3;
    for (let i = 0; i <= M; i++) {
      const [x, z] = L[i % M], [nx0, nz0] = nrm0[i % M];
      const nx = nx0 * c - nz0 * sn, nz = nx0 * sn + nz0 * c;
      const px = x - nx * S.off, pz = z - nz * S.off;
      pos.push(px, S.y0, pz, px, S.y1, pz);
      nrm.push(nx * S.sgn, 0, nz * S.sgn, nx * S.sgn, 0, nz * S.sgn);
      fac.push(us[i], S.y0 - (y - 0.1), S.k, us[i], S.y1 - (y - 0.1), S.k);
    }
    for (let i = 0; i < M; i++) { const A = b + i * 2, B = A + 1, C = A + 2, D = A + 3; idx.push(A, B, C, B, D, C); }
  }
  {
    const b = pos.length / 3;
    for (let i = 0; i <= M; i++) {
      const [x, z] = L[i % M], [nx0, nz0] = nrm0[i % M];
      const nx = nx0 * c - nz0 * sn, nz = nx0 * sn + nz0 * c;
      pos.push(x - nx * (inset - half), y + h, z - nz * (inset - half), x - nx * (inset + half), y + h, z - nz * (inset + half));
      nrm.push(0, 1, 0, 0, 1, 0);
      fac.push(us[i], 0, 10, us[i], 0.14, 10);
    }
    for (let i = 0; i < M; i++) { const A = b + i * 2, B = A + 1, C = A + 2, D = A + 3; idx.push(A, B, C, B, D, C); }
  }
  return makeGeo(pos, nrm, fac, idx);
}

const BUILDERS = { helix: helixTower, canopy: canopyTower, lens: lensTower, lattice: latticeTower, shell: shellTower, ...CROWN_BUILDERS };
const PAL_CYCLE = ['pearl', 'jade', 'bronze', 'silver', 'rose', 'pearl', 'silver', 'jade'];

// Near-detail sets (fins, rails, nodes) in height chunks, each drawn in the main view only and only
// while the camera is within NEAR_DIST of it; beyond, the massing alone reads the same.
const NEAR_DIST = 1800, NEAR_CHUNK = 260;
function attachNear(mesh, list, mat) {
  const chunks = new Map();
  for (const d of list) {
    const k = Math.floor(d.y / NEAR_CHUNK);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(d.geo);
  }
  for (const [k, geos] of chunks) {
    const yc = (k + 0.5) * NEAR_CHUNK;
    const g = mergeClean(geos).translate(0, -yc, 0);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.set(1);
    m.name = `${mesh.name} detail`;
    const lod = new THREE.LOD();
    lod.position.set(0, yc, 0);
    lod.addLevel(m, 0);
    lod.addLevel(new THREE.Object3D(), NEAR_DIST);
    mesh.add(lod);
  }
}

const FOOT_REACH = { helix: 2.85, canopy: 2.9 };

export function buildTowers(list, groundHeight, scene) {
  const out = [];
  for (const t of list) {
    const rnd = mulberry32(1000 + t.seed * 17);
    const ground = groundHeight(t.x, t.z);
    let baseY = Math.max(ground, 0.5) - 2;
    // helix / canopy stand on a plinth sized from the ground round their rim: raised to stay
    // clear of the uphill side (set at most 10 m into it), reaching down to the lowest ground
    const env = {};
    const foot = FOOT_REACH[t.type];
    if (foot) {
      let lo = ground, hi = ground;
      const reach = foot * t.radius * 1.25;
      for (let i = 0; i < 16; i++) {
        const g = groundHeight(t.x + Math.cos(i * TAU / 16) * reach, t.z + Math.sin(i * TAU / 16) * reach);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      baseY = Math.max(ground, hi - 10, 0.5) - 2;
      env.drop = baseY - Math.max(lo, 0) + 3;
    }
    // the ground round the tower, in metres above its base, at (x, z) offsets from its axis
    env.at = (dx, dz) => groundHeight(t.x + dx, t.z + dz) - baseY;
    const res = BUILDERS[t.type](t, rnd, env);
    const pal = t.palette || PAL_CYCLE[t.seed % PAL_CYCLE.length];
    const mat = createFacadeMaterial(pal, t.seed, { litFrac: 0.45 + 0.3 * rnd(), band: 96 + Math.floor(rnd() * 5) * 16 });
    const mesh = new THREE.Mesh(res.geo, mat);
    mesh.position.set(t.x, baseY, t.z);
    mesh.rotation.y = res.rot ?? rnd() * TAU;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = t.name || `tower-${t.seed}`;
    if (res.near && res.near.length) attachNear(mesh, res.near, mat);
    scene.add(mesh);
    out.push({ def: t, mesh, baseY, top: baseY + res.top, discs: res.discs, plates: res.plates, collide: res.collide, berths: res.berths, receiver: res.receiver, tips: res.tips });
  }
  return out;
}
