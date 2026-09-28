import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { ISLANDS, GATE, SKYPORT, PLAZA_Y, promenadeAxis } from './layout.js';
import { mulberry32 } from './noise.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;

/** Extrude a 2D cross-section (in side/up coordinates) along a path with a world-up frame. */
export function extrudeAlong(path, section, kindFn, { caps = false } = {}) {
  const pos = [], fac = [], idx = [];
  const n = section.length;
  let len = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < path.length; j++) {
    const a = path[Math.max(j - 1, 0)], b = path[Math.min(j + 1, path.length - 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const u2 = new THREE.Vector3().crossVectors(side, t).normalize();
    if (j > 0) len += path[j].distanceTo(path[j - 1]);
    let per = 0;
    for (let i = 0; i <= n; i++) {
      const s = section[i % n];
      if (i > 0) { const q = section[i - 1]; per += Math.hypot(s[0] - q[0], s[1] - q[1]); }
      const p = path[j];
      pos.push(p.x + side.x * s[0] + u2.x * s[1], p.y + side.y * s[0] + u2.y * s[1], p.z + side.z * s[0] + u2.z * s[1]);
      const kind = kindFn ? kindFn(i % n) : 1;
      fac.push(len, kind === 15 ? s[0] : per, kind);
    }
  }
  const cols = n + 1;
  for (let j = 0; j < path.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (caps) {
    // flat end caps (own vertices, so their normals stay flat): the section is triangulated
    // once and each triangle is wound to face out of the end it closes
    const ring = [];
    for (const s of section) {
      const q = ring[ring.length - 1];
      if (!q || Math.hypot(q[0] - s[0], q[1] - s[1]) > 1e-6) ring.push(s);
    }
    if (Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-6) ring.pop();
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((s) => new THREE.Vector2(s[0], s[1])), []);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (const [j, sign] of [[0, -1], [path.length - 1, 1]]) {
      const a = path[Math.max(j - 1, 0)], b = path[Math.min(j + 1, path.length - 1)];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      const side = new THREE.Vector3().crossVectors(t, up).normalize();
      const u2 = new THREE.Vector3().crossVectors(side, t).normalize();
      const o = pos.length / 3;
      for (const s of ring) {
        const p = path[j];
        pos.push(p.x + side.x * s[0] + u2.x * s[1], p.y + side.y * s[0] + u2.y * s[1], p.z + side.z * s[0] + u2.z * s[1]);
        fac.push(s[0], s[1], 1);
      }
      for (const tr of tris) {
        const P = (k) => new THREE.Vector3(pos[(o + tr[k]) * 3], pos[(o + tr[k]) * 3 + 1], pos[(o + tr[k]) * 3 + 2]);
        const p0 = P(0);
        nrm.crossVectors(e1.subVectors(P(1), p0), e2.subVectors(P(2), p0));
        if (nrm.dot(t) * sign >= 0) idx.push(o + tr[0], o + tr[1], o + tr[2]);
        else idx.push(o + tr[0], o + tr[2], o + tr[1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A copy of a surface with its faces reversed (own vertices, clean normals): the back of a one-sided shell. */
function backFace(g) {
  const b = g.clone();
  const ix = b.index.array;
  for (let i = 0; i < ix.length; i += 3) { const k = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = k; }
  b.computeVertexNormals();
  return b;
}

/** Lathe-profile filter: drops points below the last kept one, so a short span never folds. */
function rising() {
  let last = -Infinity;
  return (q) => (q.y >= last ? ((last = q.y), true) : false);
}

/** A flat disc of radius r at c facing n (unit): closes a tube end. */
function disc(c, n, r, seg = 16, kind = 1) {
  const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const pos = [c.x, c.y, c.z], fac = [0, 0, kind], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    pos.push(c.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r, c.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r, c.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r);
    fac.push(Math.cos(a) * r, Math.sin(a) * r, kind);
    idx.push(0, 1 + i, 1 + ((i + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ promenades --
export function frameAt(path, k) {
  const a = path[Math.max(k - 1, 0)], b = path[Math.min(k + 1, path.length - 1)];
  const t = new THREE.Vector3().subVectors(b, a).normalize();
  const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
  return { t, side };
}

/**
 * A gateway astride the deck: two tapered pylons joined by a shallow arch with a lantern.
 * With `ground` the pylons stand clear of the parapets on their own footings on the ground
 * (their foot buried, the top closed); without it they spring from the deck level (bridges).
 */
function portal(parts, p, side, base, ground = null) {
  const h = 13.5, half = ground ? 17.2 : 15.8;
  for (const s of [-1, 1]) {
    const c = p.clone().addScaledVector(side, s * half);
    const foot = ground ? Math.min(ground(c.x, c.z), base - 1.4) : base - 1;
    const pyl = latheFacade([
      ...(ground ? [{ r: 0.1, y: foot - 1.2, kind: 1 }, { r: 2.3, y: foot - 1.2, kind: 1 }, { r: 2.3, y: foot + 0.6, kind: 1 }, { r: 1.95, y: foot + 0.9, kind: 1 }] : [{ r: 1.9, y: foot, kind: 1 }]),
      { r: 1.7, y: base + 1.2, kind: 1 }, { r: 1.2, y: base + h * 0.72, kind: 1 },
      { r: 1.35, y: base + h * 0.74, kind: 2 }, { r: 1.2, y: base + h * 0.8, kind: 1 }, { r: 0.35, y: base + h, kind: 1 }, { r: 0.02, y: base + h + 1.5, kind: 1 },
    ], 12);
    pyl.translate(c.x, 0, c.z);
    parts.push(pyl);
  }
  const arc = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const x = -half + 2 * half * u;
    arc.push(p.clone().addScaledVector(side, x).add(new THREE.Vector3(0, base + h * 0.78 + 3.2 * Math.sin(Math.PI * u), 0)));
  }
  parts.push(sweepTube(arc, () => 0.55, 8, { kind: 1 }));
  parts.push(sweepTube(arc.map((q) => q.clone().add(new THREE.Vector3(0, -0.75, 0))), () => 0.2, 6, { kind: 2 }));
}

/** Build a grid surface from a function (u, v) -> [x, y, z] with a constant facade kind. */
function gridSurface(nu, nv, fn, kind, facScale = [1, 1]) {
  const pos = [], fac = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv);
    pos.push(p[0], p[1], p[2]);
    fac.push((i / nu) * facScale[0], (j / nv) * facScale[1], kind);
  }
  const cols = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i;
    idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A maglev terminal: a luminous glass seed-pod wrapped in bone-white ribs, two
 * cantilevered garden "petals" sheltering the platforms, a glowing portal ring where
 * the line enters, all on a paved plinth. c = centre at platform level, t = track
 * direction (unit, horizontal), side = horizontal normal, entry = +1/-1 (which end the
 * line comes in), groundLo = lowest ground under it.
 */
function station(parts, c, t, side, base, entry, groundLo) {
  const L = 66, W = 11.5, H = 12.5;
  const up = new THREE.Vector3(0, 1, 0);
  const P = (u, x, y) => c.clone().addScaledVector(t, u).addScaledVector(side, x).setY(base + y);
  const pod = (s) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 2.4)), 0.42);
  // plinth: a rounded-rectangle (superellipse) platform
  const plinth = latheFacade([{ r: 1, y: groundLo - base - 1.5, kind: 1 }, { r: 1, y: 0.0, kind: 1 }, { r: 0.97, y: 0.0, kind: 9 }, { r: 0.001, y: 0.0, kind: 9 }], 32);
  {
    const pp = plinth.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const ca = Math.cos(a), sa = Math.sin(a);
      const k = Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), -0.25);
      const lu = ca * k * (L / 2 + 6) * r, lx = sa * k * 14 * r;
      const q = P(lu, lx, y);
      pp.setXYZ(i, q.x, q.y, q.z);
    }
    plinth.computeVertexNormals();
    parts.push(plinth);
  }
  // the glass pod (kind 2 glows softly at night)
  // (its foot is buried in the plinth, and a back face closes the shell from inside)
  const glass = gridSurface(40, 16, (iu, iv) => {
    const s = iu * 2 - 1, a = iv * Math.PI;
    const f = pod(s);
    const sn = Math.pow(Math.sin(a), 0.85);
    return P(s * L / 2, Math.cos(a) * W * f, -0.2 + 0.6 * sn * f + sn * H * f).toArray();
  }, 14, [L, 30]);
  parts.push(glass, backFace(glass));
  // ribs: bone-white arches, fanning slightly toward the nose
  for (let k = -7; k <= 7; k++) {
    const s = k / 7.6;
    const f = pod(s) * 1.07 + 0.02;
    const arc = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      arc.push(P(s * L / 2 + Math.cos(a) * 1.2 * s, Math.cos(a) * (W * f + 0.5), 0.2 + Math.pow(Math.sin(a), 0.85) * (H * f + 0.5)));
    }
    parts.push(sweepTube(arc, (u) => 0.42 + 0.25 * Math.abs(u - 0.5), 8, { kind: 1 }));
  }
  // spine and ground beams
  const spine = [], beamL = [], beamR = [];
  for (let i = 0; i <= 30; i++) {
    const s = (i / 30) * 2 - 1;
    const f = pod(s) * 1.07 + 0.02;
    spine.push(P(s * L / 2 * 1.02, 0, 0.2 + H * f + 0.6));
    beamL.push(P(s * L / 2 * 0.96, -(W * f + 0.5), 0.5));
    beamR.push(P(s * L / 2 * 0.96, W * f + 0.5, 0.5));
  }
  parts.push(sweepTube(spine, (u) => 0.55 * Math.sin(Math.PI * u) + 0.1, 8, { kind: 1 }));
  parts.push(sweepTube(beamL, () => 0.5, 6, { kind: 1 }), sweepTube(beamR, () => 0.5, 6, { kind: 1 }));
  // petals: leaf-shaped cantilever canopies, planted on top, curling up at the tips
  for (const sd of [-1, 1]) {
    const len = L * 0.62, reach = 12;
    const leaf = (iu, iv, y0) => {
      const s = iu * 2 - 1;
      const wv = Math.pow(Math.max(0, 1 - s * s), 0.7) * reach;
      const v = iv * wv;
      const x = sd * (W * pod(s * 0.62) * 0.95 + v);
      return P(s * len / 2 + sd * 2, x, y0 + 1.6 * Math.pow(v / reach, 2) + 0.6 * Math.sin(Math.PI * iv) * (1 - s * s)).toArray();
    };
    parts.push(gridSurface(24, 6, (iu, iv) => leaf(iu, iv, 7.2), 3, [len, reach]));
    parts.push(gridSurface(24, 6, (iu, iv) => leaf(1 - iu, iv, 6.7), 1, [len, reach]));
    // the petal's edges: a 50 cm fascia band round the outer and inner rims closes the slab
    for (const e of [0, 1]) {
      const band = gridSurface(24, 1, (iu, iv) => leaf(iu, e, 6.7 + 0.5 * iv), 1, [len, 0.5]);
      parts.push(band, backFace(band));
    }
    // slender struts under each petal
    for (const s of [-0.55, 0, 0.55]) {
      const wv = Math.pow(1 - s * s, 0.7) * reach * 0.7;
      const top = P(s * len / 2 + sd * 2, sd * (W * pod(s * 0.62) * 0.95 + wv), 6.8 + 1.6 * 0.49);
      const foot = P(s * len / 2, sd * (W * pod(s * 0.62) * 0.95 + 1.5), 0.0);
      parts.push(sweepTube([foot, foot.clone().lerp(top, 0.5).add(new THREE.Vector3(0, 0.6, 0)), top], (u) => 0.28 - 0.1 * u, 6, { kind: 1 }));
    }
  }
  // portal ring where the line enters the pod
  const ring = [];
  const rc = P(entry * L / 2 * 0.99, 0, 2.6);
  const ax2 = side.clone(), ay2 = up.clone();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU;
    ring.push(rc.clone().addScaledVector(ax2, Math.cos(a) * 4.6).addScaledVector(ay2, Math.sin(a) * 4.6));
  }
  parts.push(sweepTube(ring, () => 0.45, 8, { kind: 2 }));
  // light column at the far nose: a beacon to walk toward
  const nose = P(-entry * (L / 2 + 3.5), 0, 0);
  const lc = latheFacade([{ r: 1.1, y: 0, kind: 1 }, { r: 0.8, y: 1.2, kind: 1 }, { r: 0.45, y: 9, kind: 4 }, { r: 0.7, y: 9.6, kind: 2 }, { r: 0.05, y: 10.4, kind: 1 }], 12);
  lc.translate(nose.x, base, nose.z);
  parts.push(lc);
}

function buildPromenades(groundHeight, rawHeight = groundHeight) {
  const parts = [];
  const paths = [];
  const lamps = [];
  const stations = [];
  // Deck cross-section [side, up, facade kind], wound so its faces point outward: sculpted
  // parapets with a glowing crest, a clipped hedge along each side (the lamps stand in it) and
  // a paved walkway between (kind 15: its facade v is the lateral offset from the deck's axis).
  // Points repeat where the kind changes so every face has one kind.
  const deckSection = [
    [-14.0, 0.0, 1], [-14.5, 1.2, 1], [-14.5, 1.2, 2], [-13.6, 1.4, 2], [-13.6, 1.4, 1], [-13.15, 0.95, 1],
    [-13.15, 0.95, 3], [-12.95, 1.5, 3], [-12.0, 1.7, 3], [-11.0, 1.5, 3], [-10.8, 0.95, 3],
    [-10.8, 0.95, 1], [-10.35, 0.95, 1], [-10.35, 0.2, 1],
    [-10.35, 0.2, 15], [10.35, 0.2, 15],
    [10.35, 0.2, 1], [10.35, 0.95, 1], [10.8, 0.95, 1],
    [10.8, 0.95, 3], [11.0, 1.5, 3], [12.0, 1.7, 3], [12.95, 1.5, 3], [13.15, 0.95, 3],
    [13.15, 0.95, 1], [13.6, 1.4, 1], [13.6, 1.4, 2], [14.5, 1.2, 2], [14.5, 1.2, 1], [14.0, 0.0, 1],
    [11.0, -3.2, 1], [-11.0, -3.2, 1],
  ];
  // the collar's outer loop stands 15 cm proud of the deck's fascia and soffit; its inner loop
  // is buried in the deck (same winding as the deck section)
  const jointSection = [
    [14.68, 1.28], [14.16, -0.1], [11.07, -3.36], [-11.07, -3.36], [-14.16, -0.1], [-14.68, 1.28],
    [-14.35, 1.1], [-13.85, 0.0], [-10.95, -3.05], [10.95, -3.05], [13.85, 0.0], [14.35, 1.1],
  ];
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (const isl of ISLANDS) {
    const ax = promenadeAxis(isl);
    const dir = new THREE.Vector2(ax.dir.x, ax.dir.z);
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const { start, end } = ax;
    const gL = groundHeight(ax.landing.x, ax.landing.z);
    const path = [];
    const N = 150;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = start + (end - start) * t;
      // lateral S-curve with zero offset and zero slope at both ends, so the deck meets
      // the plaza radially and lands square on the island's main avenue
      const sway = 70 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t);
      const x = dir.x * d + perp.x * sway, z = dir.y * d + perp.y * sway;
      const g0 = groundHeight(x, z);
      // the walking surface (path + 0.2) starts 35 cm proud of the plaza, a raised
      // promenade with its own kerb step: starting flush, it rose so gently that deck and
      // plaza stayed coplanar for tens of metres and z-fought
      let y = (PLAZA_Y + 0.15) * (1 - t) + (gL + 0.05) * t + 28 * Math.sin(Math.PI * t) + 5 * ss(0, 0.06, t) * (1 - ss(0.78, 1, t));
      if (t < 0.9) y = Math.max(y, g0 + 6);
      else y = Math.max(y, g0 + 0.2 + 5.8 * ss(1, 0.9, t));
      path.push(new THREE.Vector3(x, y, z));
    }
    paths.push(path);
    parts.push(extrudeAlong(path, deckSection, (i) => deckSection[i][2], { caps: true }));
    // expansion joints: a proud collar with a bright crest wraps the fascias and soffit every
    // 9 samples, articulating the deck into spans
    for (let k = 9; k < N - 4; k += 9) {
      const { t } = frameAt(path, k);
      const seg = [path[k].clone().addScaledVector(t, -0.4), path[k].clone().addScaledVector(t, 0.4)];
      parts.push(extrudeAlong(seg, jointSection, () => 1, { caps: true }));
    }
    // maglev tube along the outer edge
    // (it swings out from 17 m to 30 m off the deck axis near each end, into its terminal)
    const tube = path.map((p, i) => {
      const t = i / N;
      // (34 m at the island end keeps its terminal plinth clear of the gateway pylons; 55 cm higher
      // there so the tube rests on the plinth instead of sinking into the paving)
      const e = ss(0.1, 0.0, t) + ss(0.9, 1.0, t);
      const lat = 17 + 13 * ss(0.1, 0.0, t) + 17 * ss(0.9, 1.0, t);
      return p.clone().addScaledVector(frameAt(path, i).side, lat).add(new THREE.Vector3(0, 2.5 + 0.55 * e, 0));
    });
    parts.push(sweepTube(tube, () => 3.0, 12, { kind: 13 }));
    // end caps (sweepTube leaves the ends open)
    const tt0 = new THREE.Vector3().subVectors(tube[0], tube[1]).normalize();
    const tt1 = new THREE.Vector3().subVectors(tube[N], tube[N - 1]).normalize();
    parts.push(disc(tube[0], tt0, 3.02, 12), disc(tube[N], tt1, 3.02, 12));
    // glazing: mullion hoops every 4 samples and three ridge mullions along the crown
    const tubeFrame = (i) => {
      const tg = new THREE.Vector3().subVectors(tube[Math.min(i + 1, N)], tube[Math.max(i - 1, 0)]).normalize();
      const u = new THREE.Vector3(0, 1, 0).cross(tg).normalize();
      return { u, v: new THREE.Vector3().crossVectors(tg, u) };
    };
    for (let i = 2; i < N - 1; i += 4) {
      const { u, v } = tubeFrame(i);
      const hoop = [];
      for (let a = 0; a <= 20; a++) {
        const w = (a / 20) * TAU;
        hoop.push(tube[i].clone().addScaledVector(u, Math.cos(w) * 3.08).addScaledVector(v, Math.sin(w) * 3.08));
      }
      parts.push(sweepTube(hoop, () => 0.11, 4, { kind: 1 }));
    }
    for (const w of [-0.9, 0, 0.9]) {
      const line = tube.map((q, i) => {
        const { u, v } = tubeFrame(i);
        return q.clone().addScaledVector(u, Math.sin(w) * 3.06).addScaledVector(v, Math.cos(w) * 3.06);
      });
      parts.push(sweepTube(line, () => 0.09, 4, { kind: 1 }));
    }
    // supports: brackets from the deck soffit where the tube rides beside the deck; plinth
    // columns down to the ground (or seabed) where it swings out toward its terminals
    for (let i = 5; i < N - 4; i += 5) {
      const p = path[i], { side } = frameAt(path, i);
      const e = ss(0.1, 0.0, i / N) + ss(0.9, 1.0, i / N);
      const q = tube[i];
      if (e < 0.05) {
        const s = Math.sign(q.clone().sub(p).dot(side)) || 1;
        const a0 = p.clone().addScaledVector(side, s * 10.5).add(new THREE.Vector3(0, -2.9, 0));
        const a1 = q.clone().add(new THREE.Vector3(0, -2.6, 0));
        parts.push(sweepTube([a0, a0.clone().lerp(a1, 0.5).add(new THREE.Vector3(0, -0.8, 0)), a1], () => 0.45, 6, { kind: 1 }));
      } else {
        const g = Math.min(groundHeight(q.x, q.z), rawHeight(q.x, q.z));
        const top = q.y - 2.7;
        if (top - g < 1.2) continue;
        const col = latheFacade([{ r: 0.1, y: g - 1.5, kind: 1 }, { r: 1.6, y: g - 1.5, kind: 1 }, { r: 1.6, y: g + 0.5, kind: 1 },
          { r: 1.0, y: g + 0.8, kind: 1 }, { r: 0.8, y: top - 0.6, kind: 1 }, { r: 1.8, y: top + 0.3, kind: 1 }, { r: 0.1, y: top + 0.4, kind: 1 }]
          .filter(rising()), 10);
        col.translate(q.x, 0, q.z);
        parts.push(col);
      }
    }
    // piers with lotus capitals where the deck flies
    for (let k = 6; k < N - 3; k += 10) {
      const p = path[k];
      const base = groundHeight(p.x, p.z);
      if (base > p.y - 8) continue;
      // footing on the seabed (the raw terrain; groundHeight clamps the sea to 0), shaft,
      // and a lotus capital whose closed crown is buried in the deck just above the soffit
      const sb = Math.min(base, rawHeight(p.x, p.z));
      const pier = latheFacade([
        { r: 0.1, y: sb - 2, kind: 1 }, { r: 7, y: sb - 2, kind: 1 }, { r: 7, y: sb + 0.8, kind: 1 }, { r: 5.5, y: sb + 2.5, kind: 1 },
        { r: 3.6, y: sb + (p.y - sb) * 0.6, kind: 1 }, { r: 5, y: p.y - 7, kind: 1 }, { r: 11, y: p.y - 3.45, kind: 1 },
        { r: 10.6, y: p.y - 3.0, kind: 1 }, { r: 0.1, y: p.y - 2.9, kind: 1 },
      ].filter(rising()), 16);
      pier.translate(p.x, 0, p.z);
      parts.push(pier);
    }
    // gateways at both ends, stations where the tube comes down
    const f0 = frameAt(path, 3), f1 = frameAt(path, N - 2);
    // the pylons stand clear of the parapets on their own footings (at 15.8 m they overhung
    // the deck's edge fascia, their feet in mid-air beside it)
    portal(parts, path[3], f0.side, path[3].y + 0.2, groundHeight);
    portal(parts, path[N - 1], f1.side, path[N - 1].y + 0.2, groundHeight);
    // terminals: the line runs into the pod through its portal ring. On the plaza the
    // pod sits on the paving beside the deck; on the island it sits on the landing
    // square's platform, with the pod reaching on into town.
    {
      const e0 = tube[1].clone().setY(0), c0 = e0.clone().addScaledVector(f0.t, -(33 - 5));
      // on a 30 cm plinth, never flush with the plaza paving (coplanar tops z-fought)
      station(parts, c0, f0.t, f0.side, PLAZA_Y + 0.3, 1, PLAZA_Y - 4);
      stations.push({ x: c0.x, z: c0.z, r: 42, y: PLAZA_Y + 0.3, end: 'plaza', island: isl.id });
      const e1 = tube[N - 1].clone().setY(0), c1 = e1.clone().addScaledVector(f1.t, 33 - 5);
      let lo = 1e9, hi = -1e9;
      for (let u = -40; u <= 40; u += 8) for (let v = -15; v <= 15; v += 5) {
        const g = groundHeight(c1.x + f1.t.x * u + f1.side.x * v, c1.z + f1.t.z * u + f1.side.z * v);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      const base1 = Math.max(hi, path[N].y) + 0.6;
      station(parts, c1, f1.t, f1.side, base1, -1, lo);
      stations.push({ x: c1.x, z: c1.z, r: 42, y: base1, end: 'island', island: isl.id });
    }
    // deck lamps, staggered along both parapets
    let acc = 0;
    for (let k = 1; k <= N; k++) {
      acc += path[k].distanceTo(path[k - 1]);
      if (acc < 26) continue;
      acc = 0;
      const { side } = frameAt(path, k);
      const s = (k & 1) ? 1 : -1;
      const p = path[k].clone().addScaledVector(side, s * 12.0);
      lamps.push({ x: p.x, y: path[k].y + 0.2, z: p.z, yaw: Math.atan2(-side.x * s, -side.z * s), cls: 4 });
    }
  }
  return { geo: mergeClean(parts), paths, lamps, stations };
}

// ----------------------------------------------------------------- Gate --
function buildGate() {
  const parts = [];
  const { span, height } = GATE;
  const half = span / 2;
  for (const lean of [-0.2, 0.2]) {
    const pts = [];
    const N = 120;
    const k = 2.2;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = -half + span * u;
      const c = Math.cosh(k * (x / half));
      const y = height * (Math.cosh(k) - c) / (Math.cosh(k) - 1);
      // lean the arch out of plane; both arches meet at the base points
      const z = Math.sin(lean) * y;
      pts.push(new THREE.Vector3(x, y * Math.cos(lean) - 8, z));
    }
    parts.push(sweepTube(pts, (u) => { const m = Math.abs(u - 0.5) * 2; return 16 + 26 * Math.pow(m, 1.6); }, 20, { kind: 0, ellipse: 0.8 }));
    // luminous spine along the intrados
    parts.push(sweepTube(pts.map((p) => p.clone().add(new THREE.Vector3(0, -2, 0))), (u) => 3 + 2 * Math.abs(u - 0.5), 8, { kind: 4 }));
  }
  // keystone ring suspended at the apex
  const pts = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 70, Math.sin(a) * 70, 0)); }
  const ring = sweepTube(pts, () => 5, 10, { kind: 2 });
  ring.translate(0, height * 0.93 - 90, 0);
  parts.push(ring);
  // foundations
  for (const sx of [-1, 1]) {
    const f = latheFacade([{ r: 95, y: -12, kind: 1 }, { r: 90, y: 6, kind: 1 }, { r: 70, y: 12, kind: 3 }, { r: 0.1, y: 13, kind: 3 }], 48);
    f.translate(sx * half, 0, 0);
    parts.push(f);
  }
  const g = mergeClean(parts);
  g.translate(GATE.x, 0, GATE.z);
  return g;
}

// -------------------------------------------------------- lotus platforms --
function buildLotusPads(groundHeight, promenadePaths) {
  const rnd = mulberry32(555);
  const parts = [];
  const pads = [];
  let tries = 0;
  while (pads.length < 34 && tries < 3000) {
    tries++;
    const a = rnd() * TAU, r = 1200 + rnd() * 3800;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const pr = 36 + rnd() * 70;
    if (groundHeight(x, z) > -3) continue;
    let ok = true;
    for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < p.r + pr + 60) ok = false;
    for (const path of promenadePaths) for (let k = 0; k < path.length; k += 3) if (Math.hypot(path[k].x - x, path[k].z - z) < pr + 40) { ok = false; break; }
    if (!ok) continue;
    pads.push({ x, z, r: pr });
    const petals = 8 + Math.floor(rnd() * 6);
    const prof = [
      { r: 0.001, y: -2, kind: 1 }, { r: pr * 0.95, y: -2, kind: 1 }, { r: pr * 1.02, y: 1.8, kind: 1 }, { r: pr, y: 2.6, kind: 2 }, { r: pr * 0.94, y: 3.0, kind: 1 },
      { r: pr * 0.9, y: 3.2, kind: 3 }, { r: 0.001, y: 3.4, kind: 3 },
    ];
    const pad = latheFacade(prof, 64);
    // scalloped rim: petals
    const pp = pad.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i), pz = pp.getZ(i);
      const ang = Math.atan2(pz, px);
      const k = 1 + 0.06 * Math.cos(ang * petals);
      pp.setXYZ(i, px * k, pp.getY(i), pz * k);
    }
    pad.computeVertexNormals();
    pad.translate(x, 0, z);
    parts.push(pad);
    // the stem: a flared column from the seabed that opens into the pad's underside
    {
      const sb = groundHeight(x, z);
      const stem = latheFacade([{ r: 0.1, y: sb - 1.5, kind: 1 }, { r: pr * 0.16, y: sb - 1.5, kind: 1 }, { r: pr * 0.1, y: sb + 3, kind: 1 },
        { r: pr * 0.07, y: (sb - 2) * 0.5, kind: 1 }, { r: pr * 0.22, y: -2.4, kind: 1 }, { r: pr * 0.5, y: -1.8, kind: 1 }, { r: 0.1, y: -1.7, kind: 1 }]
        .filter(rising()), 16);
      stem.translate(x, 0, z);
      parts.push(stem);
    }
    // pavilion: dome or pagoda-like spire
    if (rnd() < 0.6) {
      const h = 12 + rnd() * 16;
      const dome = latheFacade([
        { r: 0.001, y: 3, kind: 0 }, { r: pr * 0.32, y: 3, kind: 0 }, { r: pr * 0.32, y: h * 0.5, kind: 0 }, { r: pr * 0.36, y: h * 0.55, kind: 2 },
        { r: pr * 0.3, y: h * 0.75, kind: 0 }, { r: pr * 0.18, y: h * 0.95, kind: 0 }, { r: 0.3, y: h * 1.05, kind: 1 }, { r: 0.001, y: h * 1.07, kind: 1 },
      ], 32);
      dome.translate(x + (rnd() - 0.5) * pr * 0.3, 0, z + (rnd() - 0.5) * pr * 0.3);
      parts.push(dome);
    }
  }
  return { geo: mergeClean(parts), pads };
}

// ------------------------------------------------------------- skyport ----
function buildSkyport() {
  const parts = [];
  const R = SKYPORT.r;
  // main landing ring (lens-profile torus)
  const ringPts = [];
  for (let i = 0; i <= 256; i++) { const a = (i / 256) * TAU; ringPts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
  parts.push(sweepTube(ringPts, () => 26, 16, { kind: 0, ellipse: 0.45 }));
  parts.push(sweepTube(ringPts.map((p) => p.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 10, 0))), () => 4, 8, { kind: 2 }));
  // spokes to the hub
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU;
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector3(Math.cos(a) * R * t, -30 * Math.sin(Math.PI * t) - 10 * t, Math.sin(a) * R * t)); }
    parts.push(sweepTube(pts, (t) => 7 - 3 * t, 8, { kind: 1 }));
  }
  // hub: stacked lenses with a docking spire
  parts.push(latheFacade([
    { r: 0.1, y: -140, kind: 1 }, { r: 20, y: -110, kind: 1 }, { r: 60, y: -40, kind: 0 }, { r: 90, y: -12, kind: 0 }, { r: 96, y: 0, kind: 2 },
    { r: 86, y: 14, kind: 0 }, { r: 50, y: 30, kind: 3 }, { r: 18, y: 40, kind: 1 }, { r: 10, y: 150, kind: 4 }, { r: 0.5, y: 190, kind: 1 },
  ], 64));
  // upper halo ring and short docking clamps; ships berth tangentially along the rim
  const upper = [];
  for (let i = 0; i <= 192; i++) { const a = (i / 192) * TAU; upper.push(new THREE.Vector3(Math.cos(a) * R * 0.62, 70, Math.sin(a) * R * 0.62)); }
  parts.push(sweepTube(upper, () => 12, 12, { kind: 0, ellipse: 0.5 }));
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU + TAU / 12;
    const pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10; const rr = R * 0.62 + (R - R * 0.62) * t; pts.push(new THREE.Vector3(Math.cos(a) * rr, 70 * (1 - t) + 8 * Math.sin(Math.PI * t) * 0, Math.sin(a) * rr)); }
    parts.push(sweepTube(pts, () => 4, 8, { kind: 1 }));
  }
  const berths = [];
  for (let s = 0; s < 10; s++) {
    const a = (s / 10) * TAU + 0.3;
    for (let k = 0; k <= 4; k++) {
      const pts = [new THREE.Vector3(Math.cos(a) * (R + 10), -6, Math.sin(a) * (R + 10)), new THREE.Vector3(Math.cos(a) * (R + 38), -10, Math.sin(a) * (R + 38))];
      if (k === 0) parts.push(sweepTube(pts, () => 3, 6, { kind: 1 }));
    }
    berths.push({ p: new THREE.Vector3(Math.cos(a) * (R + 52), -12, Math.sin(a) * (R + 52)), a });
  }
  const g = mergeClean(parts);
  return { geo: g, berths };
}

// Elegant starship hull (used for docked and travelling ships). The model is built at unit
// length; its facade coordinates are laid out in metres for a ship of `facadeLen` so the hull
// plating, the window bands along both flanks and the lantern ring have real proportions
// whatever the instance scale.
export function shipGeometry(len = 1, facadeLen = 130) {
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = 0.11 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) * (1 + 0.25 * Math.exp(-Math.pow((t - 0.75) / 0.08, 2)));
    prof.push({ r: r + 0.002, y: t - 0.5, kind: t > 0.72 && t < 0.8 ? 2 : t < 0.08 ? 4 : 1 });
  }
  const seg = 24;
  const g = latheFacade(prof, seg, { sx: 1, sz: 0.55 });
  {
    const P = g.attributes.position, F = g.attributes.aFacade;
    for (let j = 0; j < prof.length; j++) {
      for (let i = 0; i <= seg; i++) {
        const k = j * (seg + 1) + i;
        const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
        const r = Math.hypot(x, z / 0.55);
        const a = (i / seg) * Math.PI * 2;
        const t = y + 0.5;
        // window bands along both flanks of the habitable midsection
        const flank = (i % 12 === 0 || i % 12 === 1 || i % 12 === 11) && t > 0.18 && t < 0.7;
        F.setXYZ(k, a * r * facadeLen, y * facadeLen, flank ? 0 : F.getZ(k));
      }
    }
  }
  // fins
  const fin = latheFacade([{ r: 0.001, y: -0.5 }, { r: 0.2, y: -0.35 }, { r: 0.12, y: -0.1 }, { r: 0.001, y: 0.05 }].map((p) => ({ ...p, kind: 1 })), 3, { sx: 1, sz: 0.04 });
  {
    const F = fin.attributes.aFacade;
    for (let k = 0; k < F.count; k++) F.setXY(k, F.getX(k) * facadeLen * 0.2, F.getY(k) * facadeLen);
  }
  const m = mergeClean([g, fin]);
  m.rotateX(Math.PI / 2); // length along +Z
  m.scale(len, len, len);
  return m;
}

// ------------------------------------------------------------- beacons ----
export function createBeacons(points) {
  const n = points.length / 3;
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) seeds[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCityLights: U.uCityLights, uNight: U.uNight },
    vertexShader: /* glsl */ `
attribute float aSeed; uniform float uTime; varying float vI; varying float vRed;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = step(0.82, fract(uTime * 0.55 + aSeed));
  vRed = step(0.35, aSeed);
  vI = blink;
  gl_PointSize = clamp(9000.0 / -mv.z, 2.0, 14.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uCityLights; uniform float uNight; varying float vI; varying float vRed;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
  float core = exp(-d * 6.0);
  vec3 col = mix(vec3(1.0, 0.95, 0.9), vec3(1.0, 0.15, 0.08), vRed);
  gl_FragColor = vec4(col * core * vI * (0.6 + 3.0 * uNight), 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export function buildInfrastructure(scene, groundHeight, rawHeight) {
  const mat = createFacadeMaterial('pearl', 400, { litFrac: 0.6 });
  const prom = buildPromenades(groundHeight, rawHeight);
  const promMesh = new THREE.Mesh(prom.geo, mat);
  promMesh.castShadow = true; promMesh.receiveShadow = true;
  scene.add(promMesh);

  const gateMat = createFacadeMaterial('silver', 401, { litFrac: 0.5, band: 160 });
  const gate = new THREE.Mesh(buildGate(), gateMat);
  gate.castShadow = true; gate.receiveShadow = true;
  gate.name = 'Gate of Concord';
  scene.add(gate);

  const lotus = buildLotusPads(rawHeight, prom.paths);
  const lotusMesh = new THREE.Mesh(lotus.geo, createFacadeMaterial('jade', 402, { litFrac: 0.7 }));
  lotusMesh.castShadow = true; lotusMesh.receiveShadow = true;
  scene.add(lotusMesh);

  const sp = buildSkyport();
  const skyport = new THREE.Mesh(sp.geo, createFacadeMaterial('silver', 403, { litFrac: 0.75 }));
  skyport.position.set(SKYPORT.x, SKYPORT.y, SKYPORT.z);
  skyport.castShadow = true; skyport.receiveShadow = true;
  scene.add(skyport);
  // docked ships
  const shipMat = createFacadeMaterial('pearl', 404, { litFrac: 0.8, band: 1e5, colW: 2.6, floorH: 3.2, uplight: 0 });
  const docked = new THREE.InstancedMesh(shipGeometry(1), shipMat, sp.berths.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  sp.berths.forEach((b, i) => {
    const len = 90 + (i % 3) * 45;
    // tangential: ship's +Z along the ring direction (-sin a, 0, cos a)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.a);
    m4.compose(b.p.clone().add(new THREE.Vector3(SKYPORT.x, SKYPORT.y, SKYPORT.z)), q, new THREE.Vector3(len, len, len));
    docked.setMatrixAt(i, m4);
  });
  docked.castShadow = true;
  scene.add(docked);

  const colliders = [
    { x: SKYPORT.x, z: SKYPORT.z, y0: SKYPORT.y - 150, y1: SKYPORT.y + 200, radius: 100 },
  ];
  const beacons = [];
  beacons.push(GATE.x, GATE.height - 4, GATE.z, GATE.x - GATE.span / 2, 20, GATE.z, GATE.x + GATE.span / 2, 20, GATE.z);
  beacons.push(SKYPORT.x, SKYPORT.y + 192, SKYPORT.z);
  for (let s = 0; s < 12; s++) { const a = (s / 12) * TAU; beacons.push(SKYPORT.x + Math.cos(a) * SKYPORT.r, SKYPORT.y + 14, SKYPORT.z + Math.sin(a) * SKYPORT.r); }
  return { promenades: prom.paths, promLamps: prom.lamps, stations: prom.stations, pads: lotus.pads, colliders, beacons, berths: sp.berths };
}

// the seed-pod maglev terminal, reused by the Outer Wards and the transit network
export { station as maglevStation, portal as deckPortal };
