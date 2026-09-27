import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Procedurally painted texture arrays for vegetation (no external assets):
//  leaves: albedo+alpha and tangent-space normals for leaf-cluster cards and fronds
//  bark:   tileable albedo and normals for trunks, limbs, culms and roots
// Each is a THREE.DataArrayTexture; layer indices are exported below.

export const LEAF = { LEAFLETS: 0, BROAD: 1, PALM: 2, FERN: 3, FLOWERS: 4, BAMBOO: 5, ARAUCARIA: 6, MANGROVE: 7, BANANA: 8 };
export const BARK = { FISSURED: 0, SMOOTH: 1, PALM: 2, FERN: 3, BAMBOO: 4, FLAKY: 5, ROOT: 6 };

const LS = 512;   // leaf layer size
const BS = 256;   // bark layer size

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ------------------------------------------------------------------ leaves --
// A leaf is drawn twice: into the albedo canvas and into the normal canvas, where
// each half of the blade is filled with the normal of that half (curled blade).
class LeafPainter {
  constructor(rnd) {
    this.rnd = rnd;
    this.ca = makeCanvas(LS, LS).getContext('2d', { willReadFrequently: true });
    this.cn = makeCanvas(LS, LS).getContext('2d', { willReadFrequently: true });
    this.clear();
  }
  clear() {
    this.ca.clearRect(0, 0, LS, LS);
    this.cn.clearRect(0, 0, LS, LS);
  }
  static nrmCss(nx, ny, nz) {
    const l = Math.hypot(nx, ny, nz);
    return `rgb(${Math.round((nx / l * 0.5 + 0.5) * 255)},${Math.round((ny / l * 0.5 + 0.5) * 255)},${Math.round((nz / l * 0.5 + 0.5) * 255)})`;
  }
  /** Stem / twig / rachis as a tapered stroke. */
  stem(x0, y0, x1, y1, w0, w1, col) {
    const { ca, cn } = this;
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    const sx = -dy / L, sy = dx / L;
    for (const [ctx, fill] of [[ca, col], [cn, LeafPainter.nrmCss(0, 0, 1)]]) {
      ctx.beginPath();
      ctx.moveTo(x0 + sx * w0, y0 + sy * w0);
      ctx.lineTo(x1 + sx * w1, y1 + sy * w1);
      ctx.lineTo(x1 - sx * w1, y1 - sy * w1);
      ctx.lineTo(x0 - sx * w0, y0 - sy * w0);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }
  /**
   * Leaf blade from (x,y) along angle a. len/wid in px. shape: 0 ovate, 1 lanceolate, 2 elliptic-round.
   * col: [h,s,l] base, curl: how much the halves tilt, tilt: random whole-leaf tilt.
   */
  leaf(x, y, a, len, wid, col, { shape = 0, curl = 0.45, veins = true, gloss = 0.1 } = {}) {
    const { ca, cn, rnd } = this;
    const c = Math.cos(a), s = Math.sin(a);
    const P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
    const wA = shape === 1 ? 0.55 : shape === 2 ? 1.0 : 0.85, wB = shape === 1 ? 0.45 : shape === 2 ? 0.9 : 0.62;
    const half = (side) => {
      const k = side;
      const p0 = P(0, 0), p1 = P(len * 0.22, k * wid * wA), p2 = P(len * 0.62, k * wid * wB), p3 = P(len, 0);
      return [p0, p1, p2, p3];
    };
    const tx = (rnd() - 0.5) * 0.5, ty = (rnd() - 0.5) * 0.5;
    const [h, sat, l] = col;
    for (const side of [-1, 1]) {
      const [p0, p1, p2, p3] = half(side);
      // albedo: gradient from base to tip, lit half slightly lighter (glossy side)
      const g = ca.createLinearGradient(p0[0], p0[1], p3[0], p3[1]);
      const lb = l * (0.82 + 0.1 * side + (rnd() - 0.5) * 0.08);
      g.addColorStop(0, `hsl(${h - 4},${sat}%,${lb * 0.85}%)`);
      g.addColorStop(0.55, `hsl(${h},${sat}%,${lb}%)`);
      g.addColorStop(1, `hsl(${h + 6},${sat - 4}%,${lb * 1.12 + gloss * 8}%)`);
      for (const [ctx, fill] of [[ca, g], [cn, LeafPainter.nrmCss(-s * side * curl + tx, c * side * curl + ty, 1)]]) {
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        ctx.lineTo(p0[0], p0[1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
    if (veins && len > 10) {
      // midrib and a few lateral veins (albedo only)
      ca.strokeStyle = `hsla(${h + 10},${Math.max(0, sat - 20)}%,${Math.min(90, l * 1.5)}%,0.55)`;
      ca.lineWidth = Math.max(0.6, wid * 0.08);
      const a0 = P(0, 0), a1 = P(len * 0.92, 0);
      ca.beginPath(); ca.moveTo(a0[0], a0[1]); ca.lineTo(a1[0], a1[1]); ca.stroke();
      ca.lineWidth = Math.max(0.4, wid * 0.04);
      ca.strokeStyle = `hsla(${h},${sat}%,${l * 0.7}%,0.35)`;
      for (let k = 1; k < 5; k++) {
        const u = len * (0.15 + k * 0.16);
        for (const side of [-1, 1]) {
          const q0 = P(u, 0), q1 = P(u + len * 0.12, side * wid * 0.6);
          ca.beginPath(); ca.moveTo(q0[0], q0[1]); ca.lineTo(q1[0], q1[1]); ca.stroke();
        }
      }
    }
  }
  flower(x, y, r, petals, rot) {
    const { ca, cn, rnd } = this;
    for (let p = 0; p < petals; p++) {
      const a = rot + (p / petals) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const L = 0.2 + 0.9 * rnd() * 0.2;
      const g = ca.createRadialGradient(x, y, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgb(170,160,150)');
      g.addColorStop(0.35, 'rgb(236,232,226)');
      g.addColorStop(1, 'rgb(250,248,244)');
      for (const [ctx, fill] of [[ca, g], [cn, LeafPainter.nrmCss(c * 0.35, s * 0.35, 1)]]) {
        ctx.beginPath();
        ctx.ellipse(x + c * r * 0.5, y + s * r * 0.5, r * 0.55, r * (0.28 + L * 0.1), a, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
    ca.fillStyle = 'rgb(90,70,30)';
    ca.beginPath(); ca.arc(x, y, r * 0.16, 0, Math.PI * 2); ca.fill();
  }
  read() {
    return [this.ca.getImageData(0, 0, LS, LS).data, this.cn.getImageData(0, 0, LS, LS).data];
  }
}

const TWIG = 'rgb(74,58,42)';

function paintLeaflets(P, rnd) {
  // rain tree / forest canopy: several twigs, each with a spray of small paired leaflets
  const cx = LS / 2, cy = LS / 2;
  const sprays = 7;
  for (let k = 0; k < sprays; k++) {
    const a = (k / sprays) * Math.PI * 2 + rnd() * 0.6;
    const L = LS * (0.26 + rnd() * 0.12);
    const x0 = cx + Math.cos(a) * LS * 0.04, y0 = cy + Math.sin(a) * LS * 0.04;
    const x1 = cx + Math.cos(a) * L, y1 = cy + Math.sin(a) * L;
    P.stem(x0, y0, x1, y1, 2.2, 0.8, TWIG);
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 0.5);
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const la = a + side * (1.05 + rnd() * 0.25) - 0.25 * side * t;
        const len = LS * (0.075 + 0.03 * Math.sin(Math.PI * t)) * (0.8 + rnd() * 0.4);
        P.leaf(px, py, la, len, len * 0.34, [88 + rnd() * 16, 48 + rnd() * 10, 24 + rnd() * 10], { shape: 0, curl: 0.35 });
      }
    }
    P.leaf(x1, y1, a, LS * 0.07, LS * 0.024, [92, 50, 30], { shape: 0 });
  }
}

function paintBroad(P, rnd) {
  // fig / banyan: large glossy elliptic leaves around a central twig
  const cx = LS / 2, cy = LS / 2;
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const r0 = LS * (0.02 + rnd() * 0.08);
    const x = cx + Math.cos(a) * r0, y = cy + Math.sin(a) * r0;
    const len = LS * (0.26 + rnd() * 0.12);
    P.stem(cx, cy, x, y, 3, 2, TWIG);
    P.leaf(x, y, a + (rnd() - 0.5) * 0.5, len, len * 0.3, [100 + rnd() * 18, 42 + rnd() * 16, 17 + rnd() * 8], { shape: 2, curl: 0.5, gloss: 0.6 });
  }
}

function paintMangrove(P, rnd) {
  const cx = LS / 2, cy = LS / 2;
  for (let r = 0; r < 5; r++) {
    const a0 = rnd() * Math.PI * 2;
    const rx = cx + Math.cos(a0) * LS * 0.2, ry = cy + Math.sin(a0) * LS * 0.2;
    P.stem(cx, cy, rx, ry, 3, 2, TWIG);
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n - 0.5) * 2.6 + (rnd() - 0.5) * 0.3;
      const len = LS * (0.15 + rnd() * 0.06);
      P.leaf(rx, ry, a, len, len * 0.42, [78 + rnd() * 12, 40 + rnd() * 12, 26 + rnd() * 8], { shape: 2, curl: 0.4, gloss: 0.4 });
    }
  }
}

function paintBamboo(P, rnd) {
  const cx = LS / 2, cy = LS / 2;
  for (let k = 0; k < 10; k++) {
    const a = rnd() * Math.PI * 2;
    const x1 = cx + Math.cos(a) * LS * 0.2, y1 = cy + Math.sin(a) * LS * 0.2;
    P.stem(cx, cy, x1, y1, 1.6, 0.8, 'rgb(96,110,50)');
    for (let i = 0; i < 4; i++) {
      const la = a + (rnd() - 0.5) * 1.6;
      const len = LS * (0.2 + rnd() * 0.1);
      P.leaf(x1, y1, la, len, len * 0.09, [80 + rnd() * 16, 50 + rnd() * 10, 30 + rnd() * 10], { shape: 1, curl: 0.3, veins: false });
    }
  }
}

function paintAraucaria(P, rnd) {
  // a tier branch seen as a feather of needle-clad branchlets (branch runs along +u from the left edge)
  const y = LS / 2;
  P.stem(0, y, LS * 0.96, y, 5, 1.5, 'rgb(80,62,44)');
  for (let i = 0; i < 26; i++) {
    const t = (i + 0.5) / 26;
    const x = t * LS * 0.92;
    const L = LS * 0.42 * (1 - t * 0.55) * (0.85 + rnd() * 0.3);
    for (const side of [-1, 1]) {
      const a = side * (0.85 + rnd() * 0.25) + 0.25;
      const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
      P.stem(x, y, ex, ey, 2.2, 1.2, 'rgb(40,70,34)');
      // needles as tiny lanceolate leaves along the branchlet
      for (let k = 0; k < 11; k++) {
        const u = (k + 0.5) / 11;
        const nx = x + (ex - x) * u, ny = y + (ey - y) * u;
        for (const s2 of [-1, 1]) P.leaf(nx, ny, a + s2 * 0.9, LS * 0.03, LS * 0.006, [118 + rnd() * 10, 40, 20 + rnd() * 6], { shape: 1, veins: false, curl: 0.2 });
      }
    }
  }
}

function paintPalm(P, rnd) {
  // pinnate frond strip: rachis along v (bottom = base), long narrow leaflets angled to the tip
  const cx = LS / 2;
  P.stem(cx, LS, cx, 0, 5, 1.5, 'rgb(120,120,60)');
  const n = 44;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y = LS * (1 - t);
    const L = LS * 0.5 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (0.9 + rnd() * 0.15);
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (1.05 - t * 0.35) + (rnd() - 0.5) * 0.08;
      P.leaf(cx, y, a, L, LS * 0.022, [78 + rnd() * 10, 46 + rnd() * 10, 26 + rnd() * 8], { shape: 1, curl: 0.55, veins: false });
    }
  }
}

function paintBanana(P, rnd) {
  // a single huge paddle leaf split into strips by the wind
  const cx = LS / 2;
  const h = 95 + rnd() * 8;
  P.stem(cx, LS, cx, LS * 0.02, 7, 3, 'rgb(150,160,80)');
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const y = LS * (1 - t);
    const w = LS * 0.42 * Math.sin(Math.PI * Math.min(1, 0.05 + t * 0.98));
    if (rnd() < 0.18) continue;   // tears
    for (const side of [-1, 1]) P.leaf(cx, y, -Math.PI / 2 + side * 1.35, w, LS * 0.018, [h, 48, 28 + rnd() * 6], { shape: 1, curl: 0.25, veins: false });
  }
}

function paintFern(P, rnd) {
  // bipinnate tree-fern frond: pinnae along the rachis, each with pinnules
  const cx = LS / 2;
  P.stem(cx, LS, cx, 0, 4, 1, 'rgb(70,60,36)');
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const y = LS * (1 - t);
    const L = LS * 0.48 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9));
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (1.25 - t * 0.3);
      const ex = cx + Math.cos(a) * L, ey = y + Math.sin(a) * L;
      P.stem(cx, y, ex, ey, 1.4, 0.5, 'rgb(60,80,30)');
      const m = 10;
      for (let k = 0; k < m; k++) {
        const u = (k + 0.5) / m;
        const px = cx + (ex - cx) * u, py = y + (ey - y) * u;
        const pl = LS * 0.035 * (1 - u * 0.6);
        for (const s2 of [-1, 1]) P.leaf(px, py, a + s2 * 1.2 - 0.2 * side, pl, pl * 0.42, [96 + rnd() * 10, 52, 26 + rnd() * 8], { shape: 0, curl: 0.3, veins: false });
      }
    }
  }
}

function paintFlowers(P, rnd) {
  // leafy spray topped with a dense head of blossoms (petals painted white; tinted in the shader)
  paintLeaflets(P, rnd);
  const cx = LS / 2, cy = LS / 2;
  for (let k = 0; k < 70; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * LS * 0.36;
    P.flower(cx + Math.cos(a) * r, cy + Math.sin(a) * r, LS * (0.028 + rnd() * 0.02), 5, rnd() * 6.28);
  }
}

// ------------------------------------------------------------------- bark --
function periodicNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) perm[i] = rnd();
  const h = (x, y) => perm[((x & 63) * 64 + (y & 63)) & 4095];
  // value noise on a lattice that wraps every p cells
  return (x, y, px, py) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
    const a = h(x0, y0), b = h(x1, y0), c = h(x0, y1), d = h(x1, y1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/** Height and albedo fields for a bark type; u = around (wraps), v = along (wraps). */
function barkField(type, seed) {
  const N = periodicNoise(seed);
  const fbm = (u, v, fu, fv, oct) => {
    let s = 0, a = 0.5, n = 0;
    for (let o = 0; o < oct; o++) { s += a * N(u * fu, v * fv, fu, fv); n += a; a *= 0.5; fu *= 2; fv *= 2; }
    return s / n;
  };
  const H = new Float32Array(BS * BS), A = new Float32Array(BS * BS * 3);
  for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
    const u = i / BS, v = j / BS;
    let h = 0.5, r = 0.4, g = 0.35, b = 0.3;
    if (type === BARK.FISSURED) {
      // interlaced vertical ridges with deep fissures and cross-cracked plates
      const warp = fbm(u, v, 4, 2, 3) * 0.6;
      const f = fbm(u + warp * 0.15, v, 12, 3, 4);
      const ridge = 1 - Math.abs(f * 2 - 1);
      const plates = fbm(u, v, 8, 10, 3);
      h = Math.pow(ridge, 0.6) * 0.8 + plates * 0.2;
      const lich = Math.max(0, fbm(u, v, 6, 6, 3) - 0.58) * 3;
      const t = 0.55 + 0.45 * h;
      r = 0.30 * t; g = 0.25 * t; b = 0.20 * t;
      r = r * (1 - lich) + 0.46 * lich; g = g * (1 - lich) + 0.47 * lich; b = b * (1 - lich) + 0.38 * lich;
    } else if (type === BARK.SMOOTH) {
      const m = fbm(u, v, 4, 4, 5);
      const lent = Math.max(0, fbm(u, v, 32, 8, 2) - 0.7) * 4;   // horizontal lenticels
      h = 0.5 + 0.18 * (m - 0.5) - 0.2 * lent;
      const lich = Math.max(0, fbm(u + 3, v, 5, 5, 4) - 0.55) * 2.5;
      const t = 0.8 + 0.4 * m;
      r = 0.42 * t; g = 0.41 * t; b = 0.38 * t;
      r = r * (1 - lich) + 0.55 * lich; g = g * (1 - lich) + 0.57 * lich; b = b * (1 - lich) + 0.46 * lich;
    } else if (type === BARK.PALM) {
      // leaf-scar rings with fine vertical fibres
      const ring = Math.abs(Math.sin((v * 6 + fbm(u, v, 3, 2, 2) * 0.15) * Math.PI));
      const fib = fbm(u, v, 40, 4, 2);
      h = 0.35 + 0.45 * Math.pow(ring, 0.35) + 0.15 * fib;
      const t = 0.6 + 0.4 * h;
      r = 0.38 * t; g = 0.34 * t; b = 0.28 * t;
    } else if (type === BARK.FERN) {
      // fibrous tree-fern trunk with diamond frond scars
      const du = (u * 5) % 1, dv = (v * 7 + Math.floor(u * 5) * 0.5) % 1;
      const diamond = Math.abs(du - 0.5) + Math.abs(dv - 0.5);
      const fib = fbm(u, v, 48, 12, 3);
      h = 0.3 + 0.4 * fib + 0.3 * (diamond < 0.3 ? 0.2 : 1);
      const t = 0.5 + 0.5 * fib;
      r = 0.16 * t; g = 0.12 * t; b = 0.08 * t;
      if (diamond < 0.3) { r *= 1.6; g *= 1.5; b *= 1.3; }
    } else if (type === BARK.BAMBOO) {
      // green culm, nodes every 1/4 tile with a raised ring and dry sheath
      const node = Math.abs((v * 4) % 1 - 0.02);
      const ring = Math.exp(-node * node * 4000) + Math.exp(-Math.pow((v * 4) % 1 - 0.985, 2) * 3000);
      const str = fbm(u, v, 64, 2, 2);
      h = 0.5 + 0.4 * ring + 0.05 * str;
      const y = fbm(u, v, 3, 4, 3);
      r = 0.32 + 0.2 * y; g = 0.40 + 0.12 * y; b = 0.14;
      if (ring > 0.3) { r = 0.45; g = 0.42; b = 0.28; }
      r *= 0.9 + 0.1 * str; g *= 0.9 + 0.1 * str;
    } else if (type === BARK.FLAKY) {
      const cells = fbm(u, v, 10, 8, 2);
      const flake = Math.abs(Math.sin(cells * 20));
      h = 0.4 + 0.5 * Math.pow(flake, 0.5);
      const t = 0.6 + 0.4 * fbm(u, v, 5, 5, 3);
      r = 0.36 * t; g = 0.22 * t; b = 0.15 * t;
      if (flake < 0.25) { r *= 0.6; g *= 0.6; b *= 0.6; }
    } else if (type === BARK.ROOT) {
      // aerial roots: smooth, stringy, pale
      const s = fbm(u, v, 30, 3, 3);
      h = 0.4 + 0.5 * s;
      const t = 0.75 + 0.35 * s;
      r = 0.42 * t; g = 0.37 * t; b = 0.3 * t;
    }
    const k = j * BS + i;
    H[k] = h;
    A[k * 3] = r; A[k * 3 + 1] = g; A[k * 3 + 2] = b;
  }
  return { H, A };
}

const lin2srgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function packArray(layers, size, srgb, clamp = false) {
  const tex = new THREE.DataArrayTexture(layers, size, size, layers.length / (size * size * 4));
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cache = null;
/** Builds (once) and returns { leafAlbedo, leafNormal, barkAlbedo, barkNormal }. */
export function getNatureTextures() {
  if (cache) return cache;
  const rnd = mulberry32(8080);
  // leaves
  const painters = [paintLeaflets, paintBroad, paintPalm, paintFern, paintFlowers, paintBamboo, paintAraucaria, paintMangrove, paintBanana];
  const nL = painters.length;
  const la = new Uint8Array(LS * LS * 4 * nL), ln = new Uint8Array(LS * LS * 4 * nL);
  const P = new LeafPainter(rnd);
  painters.forEach((paint, i) => {
    P.clear();
    paint(P, rnd);
    const [a, n] = P.read();
    // leaf alpha is binary-ish; bleed colour into transparent texels to avoid dark fringes in mips
    const off = i * LS * LS * 4;
    for (let k = 0; k < LS * LS; k++) {
      const al = a[k * 4 + 3];
      la[off + k * 4] = a[k * 4]; la[off + k * 4 + 1] = a[k * 4 + 1]; la[off + k * 4 + 2] = a[k * 4 + 2]; la[off + k * 4 + 3] = al;
      if (al < 8) { la[off + k * 4] = 40; la[off + k * 4 + 1] = 62; la[off + k * 4 + 2] = 26; }
      const nl = n[k * 4 + 3];
      ln[off + k * 4] = nl > 0 ? n[k * 4] : 128; ln[off + k * 4 + 1] = nl > 0 ? n[k * 4 + 1] : 128; ln[off + k * 4 + 2] = nl > 0 ? n[k * 4 + 2] : 255; ln[off + k * 4 + 3] = 255;
    }
  });
  // canvas y runs down; flip rows so v = 0 is the bottom of the painting
  const flip = (buf, size, layers) => {
    const row = size * 4, tmp = new Uint8Array(row);
    for (let l = 0; l < layers; l++) for (let j = 0; j < size / 2; j++) {
      const a0 = (l * size + j) * row, b0 = (l * size + size - 1 - j) * row;
      tmp.set(buf.subarray(a0, a0 + row)); buf.copyWithin(a0, b0, b0 + row); buf.set(tmp, b0);
    }
  };
  flip(la, LS, nL); flip(ln, LS, nL);
  for (let k = 1; k < ln.length; k += 4) ln[k] = 255 - ln[k];   // canvas y ran downwards
  // bark
  const barkTypes = [BARK.FISSURED, BARK.SMOOTH, BARK.PALM, BARK.FERN, BARK.BAMBOO, BARK.FLAKY, BARK.ROOT];
  const ba = new Uint8Array(BS * BS * 4 * barkTypes.length), bn = new Uint8Array(BS * BS * 4 * barkTypes.length);
  barkTypes.forEach((t, li) => {
    const { H, A } = barkField(t, 100 + t * 17);
    const off = li * BS * BS * 4;
    const depth = t === BARK.FISSURED ? 9 : t === BARK.PALM ? 6 : t === BARK.FLAKY ? 5 : 3.5;
    for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
      const k = j * BS + i;
      const hl = H[j * BS + ((i + BS - 1) % BS)], hr = H[j * BS + ((i + 1) % BS)];
      const hd = H[((j + BS - 1) % BS) * BS + i], hu = H[((j + 1) % BS) * BS + i];
      let nx = (hl - hr) * depth, ny = (hd - hu) * depth, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      bn[off + k * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      bn[off + k * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      bn[off + k * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      bn[off + k * 4 + 3] = Math.round(Math.min(1, Math.max(0, H[k])) * 255);   // height = cavity AO
      ba[off + k * 4] = Math.round(lin2srgb(Math.min(1, A[k * 3])) * 255);
      ba[off + k * 4 + 1] = Math.round(lin2srgb(Math.min(1, A[k * 3 + 1])) * 255);
      ba[off + k * 4 + 2] = Math.round(lin2srgb(Math.min(1, A[k * 3 + 2])) * 255);
      ba[off + k * 4 + 3] = 255;
    }
  });
  cache = {
    leafAlbedo: packArray(la, LS, true, true),
    leafNormal: packArray(ln, LS, false, true),
    barkAlbedo: packArray(ba, BS, true),
    barkNormal: packArray(bn, BS, false),
  };
  return cache;
}
