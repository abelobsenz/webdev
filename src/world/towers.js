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

// ---------------------------------------------------------------- lens ----
// Stack of elliptical sky-plates rotating around a slender luminous core.
function lensTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const core = latheFacade([
    { r: R * 0.24, y: -4, kind: 4 }, { r: R * 0.2, y: H * 0.5, kind: 4 }, { r: R * 0.14, y: H * 0.97, kind: 4 }, { r: 0.5, y: H * 1.04, kind: 1 },
  ], 32);
  parts.push(core);
  const n = Math.max(6, Math.round(H / 95));
  const plates = [];
  for (let i = 0; i < n; i++) {
    const v = (i + 0.5) / n;
    const y = 40 + v * (H * 0.9 - 40);
    const r = R * (0.45 + 0.55 * Math.sin(Math.PI * Math.pow(v, 0.75))) * (0.9 + 0.2 * rnd());
    const thick = 16 + 18 * (1 - Math.abs(v - 0.5) * 1.6);
    const disc = latheFacade([
      { r: 0.1, y: -thick * 0.5, kind: 1 }, { r: r * 0.7, y: -thick * 0.5, kind: 1 }, { r: r * 0.97, y: -thick * 0.25, kind: 0 },
      { r: r, y: 0, kind: 0 }, { r: r * 0.97, y: thick * 0.3, kind: 0 }, { r: r * 0.88, y: thick * 0.5, kind: 3 }, { r: 0.1, y: thick * 0.5 + 1, kind: 3 },
    ], 64, { sx: 1, sz: 0.62 });
    disc.rotateY(i * 0.42 + rnd() * 0.1);
    disc.translate(0, y, 0);
    parts.push(disc);
    plates.push({ y: y + thick * 0.5, r: r * 0.6 });
  }
  return { geo: mergeClean(parts), top: H * 1.04, plates, collide: () => R * 0.3 };
}

// ------------------------------------------------------------- lattice ----
// Hyperboloid diagrid (doubly-ruled surface of straight struts) around a core.
function latticeTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const N = 28;
  const rb = R, rt = R * 0.55, twist = THREE.MathUtils.degToRad(95);
  const cyl = new THREE.CylinderGeometry(1.4, 1.4, 1, 6, 1, true);
  for (let fam = -1; fam <= 1; fam += 2) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = a0 + fam * twist;
      const p0 = new THREE.Vector3(Math.cos(a0) * rb, 0, Math.sin(a0) * rb);
      const p1 = new THREE.Vector3(Math.cos(a1) * rt, H * 0.9, Math.sin(a1) * rt);
      const pts = [];
      for (let k = 0; k <= 8; k++) pts.push(p0.clone().lerp(p1, k / 8));
      parts.push(sweepTube(pts, () => 1.6, 6, { kind: 1 }));
    }
  }
  cyl.dispose();
  // hoop rings
  const lineR = (y) => {
    const v = y / (H * 0.9);
    const ax = rb + (Math.cos(twist) * rt - rb) * v, az = Math.sin(twist) * rt * v;
    return Math.hypot(ax, az);
  };
  for (let y = 60; y < H * 0.9; y += 70) {
    const ring = new THREE.TorusGeometry(lineR(y), 1.3, 6, 96);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    const pos = ring.attributes.position;
    const fac = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { fac[i * 3] = i; fac[i * 3 + 1] = pos.getY(i); fac[i * 3 + 2] = 2; }
    ring.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
    parts.push(ring);
  }
  // occupied core with terraces
  const prof = [];
  for (let j = 0; j <= 30; j++) {
    const v = j / 30;
    prof.push({ r: R * (0.34 - 0.12 * v) * (1 + 0.05 * Math.sin(v * 40)), y: v * H * 0.93, kind: 0 });
  }
  prof.push({ r: R * 0.3, y: H * 0.95, kind: 2 });
  prof.push({ r: 0.5, y: H * 1.02, kind: 1 });
  parts.push(latheFacade(prof, 48));
  return { geo: mergeClean(parts), top: H * 1.02, collide: () => R * 0.36 };
}

// --------------------------------------------------------------- shell ----
// Twisting crescent "sail" — two nested arcs lofted with a rotating, tapering section.
function shellTower(t, rnd) {
  const H = t.height, R = t.radius;
  const levels = Math.max(70, Math.round(H / 11));
  const nOuter = 48, nInner = 40;
  const sections = [];
  for (let j = 0; j <= levels; j++) {
    const v = j / levels;
    const y = v * H * 0.96;
    const s = (1 - 0.72 * Math.pow(v, 1.3)) * (1 + 0.3 * Math.exp(-v * 10));
    const rot = v * Math.PI * 0.85 + (t.seed || 0);
    const pts = [];
    const span = THREE.MathUtils.degToRad(125);
    for (let i = 0; i < nOuter; i++) {
      const a = -span + (i / (nOuter - 1)) * 2 * span;
      pts.push([Math.cos(a + rot) * R * s, Math.sin(a + rot) * R * s]);
    }
    const off = 0.42 * R * s;
    for (let i = 0; i < nInner; i++) {
      const a = span - (i / (nInner - 1)) * 2 * span;
      const rr = R * s * 0.78;
      const x = Math.cos(a) * rr + off, z = Math.sin(a) * rr;
      pts.push([x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
    }
    sections.push({ y, pts, kind: v > 0.9 ? 2 : 0 });
  }
  const body = loftSections(sections, { capTop: true, kindTop: 2 });
  const spire = latheFacade([{ r: R * 0.06, y: H * 0.9, kind: 1 }, { r: 0.5, y: H * 1.08, kind: 1 }], 10);
  return { geo: mergeClean([body, spire]), top: H * 1.08, collide: (y) => R * (1 - 0.72 * Math.pow(y / H, 1.3)) };
}

const BUILDERS = { helix: helixTower, canopy: canopyTower, lens: lensTower, lattice: latticeTower, shell: shellTower, ...CROWN_BUILDERS };
const PAL_CYCLE = ['pearl', 'jade', 'bronze', 'silver', 'rose', 'pearl', 'silver', 'jade'];

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
    const res = BUILDERS[t.type](t, rnd, env);
    const pal = t.palette || PAL_CYCLE[t.seed % PAL_CYCLE.length];
    const mat = createFacadeMaterial(pal, t.seed, { litFrac: 0.45 + 0.3 * rnd(), band: 96 + Math.floor(rnd() * 5) * 16 });
    const mesh = new THREE.Mesh(res.geo, mat);
    mesh.position.set(t.x, baseY, t.z);
    mesh.rotation.y = rnd() * TAU;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = t.name || `tower-${t.seed}`;
    scene.add(mesh);
    out.push({ def: t, mesh, baseY, top: baseY + res.top, discs: res.discs, plates: res.plates, collide: res.collide, berths: res.berths, receiver: res.receiver, tips: res.tips });
  }
  return out;
}
