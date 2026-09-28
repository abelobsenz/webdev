import { K, TAU, rect, lerp2 } from './cityKit.js';

// Monuments and civic furniture of the island cities, all closed solids in a local frame:
// O the origin (plan), A the unit "along" direction, B = its left normal. f(u, v) -> plan.
export const frameOf = (O, a) => { const A = [Math.cos(a), Math.sin(a)], B = [-A[1], A[0]]; return { O, A, B, a, f: (u, v) => [O[0] + A[0] * u + B[0] * v, O[1] + A[1] * u + B[1] * v] }; };

/** A colonnade: n columns from (u0) to (u1) at v, on y, height h, with its entablature beam. */
export function colonnade(kit, F, u0, u1, v, y, h, { n, r = 0.55, beamD = 1.6, beamH = 1.2, seg = 8, tier = 1, beamTier = 3 } = {}) {
  const L = u1 - u0, count = n ?? Math.max(2, Math.round(L / (r * 7)) + 1);
  for (let k = 0; k < count; k++) {
    const p = F.f(u0 + (L * k) / (count - 1), v);
    kit.at(p[0], p[1], tier).column(p[0], p[1], y, h, r, { seg, meta: { role: 'column', supported: true } });
  }
  const c = F.f((u0 + u1) / 2, v);
  kit.at(c[0], c[1], beamTier).prism(rect(c[0], c[1], L + r * 3, beamD, F.a), y + h - 0.02, y + h + beamH, { wall: K.STONE, top: K.STONE, meta: { role: 'entablature', supported: true } });
}

/**
 * A stoa: a colonnaded hall open to its front (+v side), closed at the back: back wall, two
 * end walls, a front colonnade and a flat roof slab with a cornice. Frame: u along the hall,
 * v toward the front; the hall spans u in [0, L], v in [0, D].
 */
export function stoa(kit, F, L, D, y, h, { tier = 3, colTier = 1, roof = K.STONE } = {}) {
  const t = 1.2;
  const box = (u0, u1, v0, v1, y0, y1, opts) => { const q = [F.f(u0, v0), F.f(u1, v0), F.f(u1, v1), F.f(u0, v1)]; const c = F.f((u0 + u1) / 2, (v0 + v1) / 2); kit.at(c[0], c[1], tier).prism(q, y0, y1, opts); };
  box(0, L, 0, t, y - 0.2, y + h + 1.2, { wall: K.PUNCHED, top: K.STONE, vBase: y, meta: { role: 'stoa wall', supported: true } });
  for (const u of [0, L - t]) box(u, u + t, t, D, y - 0.2, y + h + 1.2, { wall: K.STONE, top: K.STONE, meta: { role: 'stoa end wall', supported: true } });
  colonnade(kit, F, t + 1.3, L - t - 1.3, D - 0.8, y, h, { r: 0.6, tier: colTier, beamTier: tier });
  // the roof slab rests on the walls and the entablature; its cornice overhangs the front
  box(-0.4, L + 0.4, -0.4, D + 0.6, y + h + 1.2 - 0.02, y + h + 2.0, { wall: K.STONE, top: roof, meta: { role: 'stoa roof', supported: true } });
}

/** A round temple (tholos): stepped crepidoma, peristyle, cella drum, dome and lantern. */
export function tholos(kit, x, z, y, R, { cols = 12, colH, tier = 3, colTier = 1, gilt = false, domeKind = K.STONE, giltDome = false } = {}) {
  const ch = colH ?? R * 1.4;
  kit.at(x, z, tier).lathe(x, z, [[R + 1.8, y - 0.25, K.STONE], [R + 1.8, y + 0.35, K.STONE], [R + 1.1, y + 0.35, K.PAVING], [R + 1.1, y + 0.7, K.STONE], [R + 0.4, y + 0.7, K.PAVING], [R + 0.4, y + 1.05, K.STONE], [0, y + 1.05, K.PAVING]], 32, { meta: { role: 'tholos base', supported: true } });
  const y1 = y + 1.05;
  const cr = Math.max(0.3, R * 0.07);
  for (let k = 0; k < cols; k++) { const a = (k / cols) * TAU; kit.at(x, z, colTier).column(x + Math.cos(a) * R, z + Math.sin(a) * R, y1, ch, cr, { meta: { role: 'column', supported: true } }); }
  // cella and entablature
  const dome = Array.from({ length: 7 }, (_, i) => { const t = ((i + 1) / 8) * Math.PI / 2; return [Math.max(0.05, R * 0.7 * Math.cos(t)), y1 + ch + R * 0.22 + Math.sin(t) * R * 0.55, domeKind]; });
  if (giltDome) {
    // the cella and entablature end in a flat roof on which the gilt dome stands
    kit.at(x, z, tier).lathe(x, z, [[R * 0.62, y1 - 0.1, K.PUNCHED], [R * 0.62, y1 + ch, K.STONE], [R + cr * 1.6, y1 + ch - 0.02, K.STONE], [R + cr * 1.6, y1 + ch + R * 0.12, K.STONE], [R * 0.7, y1 + ch + R * 0.12, K.STONE], [R * 0.7, y1 + ch + R * 0.22, K.STONE], [0, y1 + ch + R * 0.22, K.STONE]], 32, { meta: { role: 'tholos cella', supported: true } });
    kit.at(x, z, tier, 'gilt').lathe(x, z, [[R * 0.7, y1 + ch + R * 0.22 - 0.02, domeKind], ...dome, [0, y1 + ch + R * 0.22 + R * 0.58, domeKind]], 32, { meta: { role: 'tholos dome', supported: true } });
  } else kit.at(x, z, tier).lathe(x, z, [[R * 0.62, y1 - 0.1, K.PUNCHED], [R * 0.62, y1 + ch, K.STONE], [R + cr * 1.6, y1 + ch - 0.02, K.STONE], [R + cr * 1.6, y1 + ch + R * 0.12, K.STONE], [R * 0.7, y1 + ch + R * 0.12, K.STONE], [R * 0.7, y1 + ch + R * 0.22, K.STONE],
    ...dome, [0.05, y1 + ch + R * 0.22 + R * 0.58, domeKind]], 32, { meta: { role: 'tholos dome', supported: true } });
  const top = y1 + ch + R * 0.22 + R * 0.55, apex = y1 + ch + R * 0.22 + R * 0.58;
  if (gilt) kit.at(x, z, tier, 'gilt').lathe(x, z, [[R * 0.12, apex - 0.25, K.LANTERN], [R * 0.12, top + R * 0.25, K.LANTERN], [0.02, top + R * 0.5, K.LANTERN]], 12, { meta: { role: 'finial', supported: true } });
  return top;
}

/**
 * A gateway of three arched passages: a wall in the (v, y) plane across the axis A at u,
 * thickness T along A; openings centred at v = 0 (main) and +-spacing (side).
 */
export function archGate(kit, F, u, y, { W = 64, T = 9, Hh = 24, main = [11, 16], side = [6, 10], spacing = 17, tier = 3 } = {}) {
  const arch = (vc, w, h) => {
    const r = w / 2, pts = [[vc + r, y], [vc + r, y + h - r]];
    for (let k = 1; k < 12; k++) { const t = (k / 12) * Math.PI; pts.push([vc + Math.cos(t) * r, y + h - r + Math.sin(t) * r]); }
    pts.push([vc - r, y + h - r], [vc - r, y]);
    return pts;
  };
  // outline from the left foot, over the top, down the right, then along the ground with the
  // passages cut up into it (right to left)
  const prof = [[-W / 2, y], [-W / 2, y + Hh], [W / 2, y + Hh], [W / 2, y]];
  for (const [vc, [w, h]] of [[spacing, side], [0, main], [-spacing, side]]) prof.push(...arch(vc, w, h));
  // the (v, y) plane: horizontal unit B, extruded along A from u - T/2 to u + T/2
  const O = F.f(u, 0);
  kit.at(O[0], O[1], tier).extrude(prof.map(([v, yy]) => [v, yy]), O, F.B, F.A, -T / 2, T / 2, { kinds: () => K.STONE, meta: { role: 'gate', supported: true } });
  // attic and cornice
  const c = F.f(u, 0);
  kit.at(c[0], c[1], tier).prism(rect(c[0], c[1], T + 1.6, W + 1.6, F.a), y + Hh - 0.02, y + Hh + 1.4, { wall: K.STONE, top: K.STONE, meta: { role: 'gate cornice', supported: true } });
  kit.at(c[0], c[1], tier).prism(rect(c[0], c[1], T - 1, W * 0.6, F.a), y + Hh + 1.38, y + Hh + 6, { wall: K.STONE, top: K.STONE, meta: { role: 'gate attic', supported: true } });
}

/** A lighthouse: a tapering tower on a round base, gallery, lantern (lit), cap. */
export function lighthouse(kit, x, z, y, h, r = 4.2, { tier = 3 } = {}) {
  kit.at(x, z, tier).lathe(x, z, [[r * 1.5, y - 0.2, K.STONE], [r * 1.5, y + 3, K.STONE], [r, y + 3, K.STONE], [r * 0.72, y + h * 0.82, K.STONE], [r * 1.02, y + h * 0.83, K.STONE], [r * 1.02, y + h * 0.85, K.STONE], [r * 0.62, y + h * 0.85, K.LANTERN], [r * 0.62, y + h * 0.95, K.LANTERN], [r * 0.72, y + h * 0.95, K.METAL], [0.05, y + h + 2, K.METAL]], 16, { meta: { role: 'lighthouse', supported: true } });
}

/** An obelisk on a plinth. */
export function obelisk(kit, x, z, y, h, r, { tier = 2, tip = K.STONE, mat } = {}) {
  kit.at(x, z, tier).lathe(x, z, [[r * 1.9, y - 0.1, K.STONE], [r * 1.9, y + r * 1.4, K.STONE], [r * 1.05, y + r * 1.4, K.STONE], [r * 0.66, y + h * 0.9, K.STONE], [0.02, y + h, tip]], 4, { meta: { role: 'obelisk', supported: true }, phase: Math.PI / 4 });
  void mat;
}

/** A round fountain: basin rim, water, and a stepped centre bowl. */
export function fountain(kit, x, z, y, r, { tier = 1 } = {}) {
  kit.at(x, z, tier).lathe(x, z, [[r, y - 0.1, K.STONE], [r, y + 0.55, K.STONE], [r - 0.35, y + 0.55, K.STONE], [r - 0.35, y + 0.35, K.POOL], [0, y + 0.35, K.POOL]], 32, { meta: { role: 'fountain basin', supported: true } });
  kit.at(x, z, tier).lathe(x, z, [[r * 0.22, y + 0.3, K.STONE], [r * 0.12, y + 1.6, K.STONE], [r * 0.3, y + 1.9, K.STONE], [r * 0.3, y + 2.05, K.STONE], [0, y + 2.05, K.POOL]], 16, { meta: { role: 'fountain bowl', supported: true } });
}

/** A semicircular exedra bench wall, opening toward the direction a. */
export function exedra(kit, x, z, y, r, a, { tier = 1, h = 1.1, t = 0.9 } = {}) {
  const pts = [];
  for (let k = 0; k <= 16; k++) { const t0 = a + Math.PI / 2 + (k / 16) * Math.PI; pts.push([x + Math.cos(t0) * r, z + Math.sin(t0) * r]); }
  const sec = () => [{ a: [t / 2, y - 0.1], b: [t / 2, y + h], kind: K.STONE }, { a: [t / 2, y + h], b: [-t / 2, y + h], kind: K.STONE }, { a: [-t / 2, y + h], b: [-t / 2, y - 0.1], kind: K.STONE }];
  kit.at(x, z, tier).sweep(pts, sec, { meta: { role: 'exedra', supported: true } });
}
export { lerp2 };
