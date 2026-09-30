import * as THREE from 'three';
import { R_MOON } from './sim.js';
import { ALL_TOWNS, latLonDir } from './lunarNetwork.js';
import { BAY } from './lunarSite.js';

// The terraformed Moon's relief: ONE height function, written twice side by side (GLSL for the
// terrain mesh and the shading, JavaScript for the ground the ship stands on), both generated
// from the same table of constants so they cannot drift apart.
//
// The noise is integer-hashed gradient noise (quintic Perlin with analytic derivatives): the
// lattice hash runs on 32-bit unsigned integers, which GLSL ES 3.0 and JavaScript (Math.imul)
// compute bit for bit alike, so the CPU and the GPU agree on every lattice gradient (a float
// permutation polynomial, like the simplex noise elsewhere in the shaders, can round differently
// on a GPU and pick another gradient). The rest is plain float arithmetic: float32 on the GPU,
// doubles here, agreeing to well under a metre.
//
// The relief rides on the baked Moon (moonBake.js), which only the GPU renders: its water, its
// height and its woods are read back once into a small vertex-centred cube map (GMASK_N texels a
// face edge, faces stacked in one 2D texture) that both sides sample with the same hand-written
// bilinear filter (texelFetch on the GPU, the same arithmetic here).
//   r  landness: 1 - the bake's water, dilated ~3 km, so the relief dies away before any coast
//   g  the bake's height / 5 km (highland relief is bolder)
//   b  the bake's water at the texel (open water: the ground contract's `water` flag)
//   a  woodland density (the bake's dark greens): where the 3D trees stand

export const GMASK_N = 512;

// ---- the relief table (km) ----
function rotMat(ax, ay, az, ang) {
  const l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  // row-major rows of R (q = R p)
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ].map((v) => +v.toFixed(7));
}
const OCT = [
  // wavelength, amplitude (km), ridged share on the highlands
  [30.0, 0.48, 0.55],
  [13.5, 0.29, 0.7],
  [6.1, 0.16, 0.8],
  [2.75, 0.088, 0.75],
  [1.24, 0.048, 0.6],
  [0.56, 0.025, 0.45],
  [0.25, 0.012, 0.3],
  [0.115, 0.0045, 0.2],
  [0.052, 0.0022, 0.1],
];
export const RELIEF = {
  warp: { lam: 36.0, amp: 3.8, rot: rotMat(1, 2, 3, 0.7), off: [31.7, 7.3, 13.1] },
  region: { lam: 160.0, lo: -0.3, hi: 0.5, rot: rotMat(3, 1, 2, 1.1), off: [5.3, 17.9, 2.2] },
  valley: { lam: 28.0, width: 0.075, depth: 0.28, rot: rotMat(2, 3, 1, 2.3), off: [11.1, 3.7, 23.3] },
  mesa: { lam: 21.0, step: 0.085, lo: 0.2, hi: 0.5, k: 0.7, rot: rotMat(1, 3, 2, 0.4), off: [2.9, 29.3, 8.8] },
  oct: OCT.map(([lam, amp, ridge], i) => ({ lam, amp, ridge, rot: rotMat(1 + i, 2 - i * 0.3, 3 + i * 0.7, 0.9 + i * 1.37), off: [+(i * 17.31 % 50).toFixed(2), +(i * 5.13 % 50).toFixed(2), +(i * 11.77 % 50).toFixed(2)] })),
  lift: 0.1,            // relief baseline over the land (scaled): most land stands a little proud
  ampLow: 0.28,         // relief scale on the low plains (1 on the highlands)
  erosion: 5.0,         // octave damping by the slope already built (valleys smooth, ridges sharp)
  floorK: 0.03,         // softness of the floor at sea level (km): the coastal and river flats
  bakeHiLo: 0.4, bakeHiHi: 2.8,   // bake height (km) over which the relief grows bold
  site: { flat0: 10.0, flat1: 14.0, drvW0: 0.6, drvW1: 1.4, town0: 1.5, town1: 3.0, bay0: 0.08, bay1: 0.4 },
};
const DRV_P0 = [2.192, 1.061], DRV_D = [0.9701, 0.2425], DRV_LEN = 36.0;
const TOWN_D = ALL_TOWNS.map(([la, lo]) => { const v = latLonDir(la, lo); return [+v.x.toFixed(7), +v.y.toFixed(7), +v.z.toFixed(7)]; });

// hash constants (uint32)
const HX = 2376512323, HY = 3625172993, HZ = 3407524639, HM1 = 739982445, HM2 = 695872825;

const f7 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const m3 = (r) => `mat3(${[r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]].map(f7).join(', ')})`;   // GLSL is column-major
const v3 = (o) => `vec3(${o.map(f7).join(', ')})`;

// ---------------------------------------------------------------------------------------------
// GLSL (needs RM defined, SITE_GLSL for bayDist)
// ---------------------------------------------------------------------------------------------
export const RELIEF_GLSL = /* glsl */ `
// ---- the relief (moonTerrain.js: the same function the ship stands on) ----
uniform sampler2D uGMask;
uniform float uGMaskN;         // face edge in texels; 0 until the bake is read back
uint tHash(ivec3 c) {
  uvec3 q = uvec3(c + 65536);
  uint n = (q.x * ${HX}u) ^ (q.y * ${HY}u) ^ (q.z * ${HZ}u);
  n ^= n >> 15u; n *= ${HM1}u; n ^= n >> 12u; n *= ${HM2}u; n ^= n >> 15u;
  return n;
}
vec3 tGrad(ivec3 c) {
  uint n = tHash(c);
  return vec3(float(n & 1023u), float((n >> 10u) & 1023u), float((n >> 20u) & 1023u)) * (1.0 / 512.0) - 1.0;
}
// quintic gradient noise: x value (about -1..1), yzw its gradient
vec4 tNoise(vec3 x) {
  vec3 fl = floor(x);
  ivec3 i = ivec3(fl);
  vec3 w = x - fl;
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  vec3 ga = tGrad(i), gb = tGrad(i + ivec3(1, 0, 0)), gc = tGrad(i + ivec3(0, 1, 0)), gd = tGrad(i + ivec3(1, 1, 0));
  vec3 ge = tGrad(i + ivec3(0, 0, 1)), gf = tGrad(i + ivec3(1, 0, 1)), gg = tGrad(i + ivec3(0, 1, 1)), gh = tGrad(i + ivec3(1, 1, 1));
  float va = dot(ga, w), vb = dot(gb, w - vec3(1.0, 0.0, 0.0)), vc = dot(gc, w - vec3(0.0, 1.0, 0.0)), vd = dot(gd, w - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, w - vec3(0.0, 0.0, 1.0)), vf = dot(gf, w - vec3(1.0, 0.0, 1.0)), vg = dot(gg, w - vec3(0.0, 1.0, 1.0)), vh = dot(gh, w - vec3(1.0, 1.0, 1.0));
  float k1 = vb - va, k2 = vc - va, k3 = ve - va, k4 = va - vb - vc + vd, k5 = va - vc - ve + vg, k6 = va - vb - ve + vf, k7 = -va + vb + vc - vd + ve - vf - vg + vh;
  float v = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
         + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
         + du * (vec3(k1, k2, k3) + u.yzx * vec3(k4, k5, k6) + u.zxy * vec3(k6, k4, k5) + u.yzx * u.zxy * k7);
  return vec4(v, d);
}
vec4 gmTexel(int f, int i, int j) {
  int n = int(uGMaskN);
  return texelFetch(uGMask, ivec2(clamp(i, 0, n - 1), f * n + clamp(j, 0, n - 1)), 0);
}
// the read-back bake at a direction: vertex-centred faces, bilinear by hand
vec4 gmask(vec3 d) {
  if (uGMaskN < 2.0) return vec4(0.0, 0.0, 0.0, 0.0);
  vec3 a = abs(d);
  int f; float u, v;
  if (a.x >= a.y && a.x >= a.z) { f = d.x >= 0.0 ? 0 : 1; u = d.z / a.x; v = d.y / a.x; }
  else if (a.y >= a.z) { f = d.y >= 0.0 ? 2 : 3; u = d.x / a.y; v = d.z / a.y; }
  else { f = d.z >= 0.0 ? 4 : 5; u = d.x / a.z; v = d.y / a.z; }
  float n1 = uGMaskN - 1.0;
  float x = clamp((u * 0.5 + 0.5) * n1, 0.0, n1), y = clamp((v * 0.5 + 0.5) * n1, 0.0, n1);
  float x0 = min(floor(x), n1 - 1.0), y0 = min(floor(y), n1 - 1.0);
  float fx = x - x0, fy = y - y0;
  int i = int(x0), j = int(y0);
  vec4 t00 = gmTexel(f, i, j), t10 = gmTexel(f, i + 1, j), t01 = gmTexel(f, i, j + 1), t11 = gmTexel(f, i + 1, j + 1);
  return (t00 * (1.0 - fx) + t10 * fx) * (1.0 - fy) + (t01 * (1.0 - fx) + t11 * fx) * fy;
}
const vec3 TOWN_D[${TOWN_D.length}] = vec3[${TOWN_D.length}](${TOWN_D.map(v3).join(', ')});
// where the relief may stand: not on the Landing's town site and farm plain, the mass driver's
// line, the towns, the Bay, or near any coast (the read-back landness)
float reliefMask(vec3 up, vec4 gm) {
  float land = smoothstep(0.3, 0.95, gm.r);
  vec2 lxz = vec2(up.z, up.y) * RM;                        // site frame (x west, z north), km
  float siteD = length(lxz);
  float m = land;
  if (up.x > 0.5) {
    m *= smoothstep(${f7(RELIEF.site.flat0)}, ${f7(RELIEF.site.flat1)}, siteD);
    vec2 q = lxz - vec2(${f7(DRV_P0[0])}, ${f7(DRV_P0[1])});
    float t = clamp(dot(q, vec2(${f7(DRV_D[0])}, ${f7(DRV_D[1])})), 0.0, ${f7(DRV_LEN)});
    float dp = length(q - vec2(${f7(DRV_D[0])}, ${f7(DRV_D[1])}) * t);
    m *= smoothstep(${f7(RELIEF.site.drvW0)}, ${f7(RELIEF.site.drvW1)}, dp);
    float bd = ${f7(+BAY.r.toFixed(4))} - length(lxz - vec2(${f7(+BAY.x.toFixed(4))}, ${f7(+BAY.z.toFixed(4))}));
    m *= smoothstep(${f7(RELIEF.site.bay0)}, ${f7(RELIEF.site.bay1)}, -bd);
  }
  for (int i = 0; i < ${TOWN_D.length}; i++) {
    float dk = length(up - TOWN_D[i]) * RM;
    m *= smoothstep(${f7(RELIEF.site.town0)}, ${f7(RELIEF.site.town1)}, dk);
  }
  return m;
}
// the relief (km above the sphere) and its gradient (tangent plane, km/km). fade: the size below
// which an octave drops out (a vertex spacing or a pixel footprint; 0 = every octave, which is what
// the ship stands on). hiOut: the highland share (0 plains .. 1 mountains); vOut: the valley floor.
float reliefHG(vec3 up, float fade, out vec3 grad, out float hiOut, out float vOut) {
  grad = vec3(0.0); hiOut = 0.0; vOut = 0.0;
  vec4 gm = gmask(up);
  float M = reliefMask(up, gm);
  if (M <= 0.0) return 0.0;
  vec3 P = up * RM;
  vec4 wn = tNoise(${m3(RELIEF.warp.rot)} * (P / ${f7(RELIEF.warp.lam)}) + ${v3(RELIEF.warp.off)});
  vec3 Pw = P + wn.yzw * ${f7(RELIEF.warp.amp)};
  vec4 rn = tNoise(${m3(RELIEF.region.rot)} * (P / ${f7(RELIEF.region.lam)}) + ${v3(RELIEF.region.off)});
  float hi = clamp(max(smoothstep(${f7(RELIEF.region.lo)}, ${f7(RELIEF.region.hi)}, rn.x), smoothstep(${f7(RELIEF.bakeHiLo)}, ${f7(RELIEF.bakeHiHi)}, gm.g * 5.0)), 0.0, 1.0);
  float S = mix(${f7(RELIEF.ampLow)}, 1.0, hi);
  // river valleys: where a broad warped field crosses zero, a winding floor carved into the land
  vec4 vn = tNoise(${m3(RELIEF.valley.rot)} * (Pw / ${f7(RELIEF.valley.lam)}) + ${v3(RELIEF.valley.off)});
  float av = abs(vn.x);
  float vv = 1.0 - smoothstep(0.0, ${f7(RELIEF.valley.width)}, av);
  float raw = ${f7(RELIEF.lift)} * S - ${f7(RELIEF.valley.depth)} * S * vv * vv;
  {
    float tv = clamp(av / ${f7(RELIEF.valley.width)}, 0.0, 1.0);
    float dsm = 6.0 * tv * (1.0 - tv) / ${f7(RELIEF.valley.width)};
    vec3 dvn = (vn.yzw * ${m3(RELIEF.valley.rot)}) / ${f7(RELIEF.valley.lam)};
    grad += ${f7(RELIEF.valley.depth)} * S * 2.0 * vv * dsm * sign(vn.x) * dvn;
  }
${RELIEF.oct.map((o, i) => `  {
    float w = 1.0 - smoothstep(${f7(+(o.lam * 0.2).toFixed(5))}, ${f7(+(o.lam * 0.45).toFixed(5))}, fade);
    if (w > 0.0) {
      vec4 n = tNoise(${m3(o.rot)} * (Pw / ${f7(o.lam)}) + ${v3(o.off)});
      vec3 dn = (n.yzw * ${m3(o.rot)}) / ${f7(o.lam)};
      float rk = ${f7(o.ridge)} * hi;
      float val = mix(n.x, 0.8 - 1.6 * abs(n.x), rk);
      vec3 dval = mix(dn, -1.6 * sign(n.x) * dn, rk);
      float a = ${f7(o.amp)} * S * w${i >= 2 ? ` / (1.0 + ${f7(RELIEF.erosion)} * dot(grad, grad))` : ''}${i >= 3 ? ' * (1.0 - 0.6 * vv)' : ''};
      raw += a * val;
      grad += a * dval;
    }
  }`).join('\n')}
  // mesas and scarps: in patches of the highlands the land steps in benches and cliffs
  vec4 mn = tNoise(${m3(RELIEF.mesa.rot)} * (P / ${f7(RELIEF.mesa.lam)}) + ${v3(RELIEF.mesa.off)});
  float mk = smoothstep(${f7(RELIEF.mesa.lo)}, ${f7(RELIEF.mesa.hi)}, mn.x) * hi * ${f7(RELIEF.mesa.k)};
  if (mk > 0.0 && raw > 0.0) {
    float t = raw / ${f7(RELIEF.mesa.step)};
    float fl = floor(t), fr = t - fl;
    float st = clamp((fr - 0.55) / 0.3, 0.0, 1.0);
    float sm = st * st * (3.0 - 2.0 * st);
    float ter = (fl + sm) * ${f7(RELIEF.mesa.step)};
    float dter = 6.0 * st * (1.0 - st) / 0.3;
    raw = mix(raw, ter, mk);
    grad *= mix(1.0, dter, mk);
  }
  // the floor at sea level: lowland hollows become flats (coastal plains, valley meadows)
  float sq = sqrt(raw * raw + ${f7(+(RELIEF.floorK * RELIEF.floorK).toFixed(7))});
  float h = 0.5 * (raw + sq);
  grad *= 0.5 * (1.0 + raw / sq) * M;
  grad -= up * dot(grad, up);
  hiOut = hi; vOut = vv;
  return h * M;
}
float reliefH(vec3 up, float fade) { vec3 g; float a, b; return reliefHG(up, fade, g, a, b); }
`;

// ---------------------------------------------------------------------------------------------
// JavaScript (the same, operation for operation)
// ---------------------------------------------------------------------------------------------
const imul = Math.imul;
function tHash(x, y, z) {
  const qx = (x + 65536) >>> 0, qy = (y + 65536) >>> 0, qz = (z + 65536) >>> 0;
  let n = (imul(qx, HX) ^ imul(qy, HY) ^ imul(qz, HZ)) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0; n = imul(n, HM1) >>> 0;
  n = (n ^ (n >>> 12)) >>> 0; n = imul(n, HM2) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  return n;
}
const G = new Float64Array(24);
function tGrad(x, y, z, k) {
  const n = tHash(x, y, z);
  G[k] = (n & 1023) * (1 / 512) - 1; G[k + 1] = ((n >>> 10) & 1023) * (1 / 512) - 1; G[k + 2] = ((n >>> 20) & 1023) * (1 / 512) - 1;
}
/** Quintic gradient noise at (x, y, z): out[0] value, out[1..3] gradient. */
export function tNoise(x, y, z, out) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const wx = x - fx, wy = y - fy, wz = z - fz;
  const ux = wx * wx * wx * (wx * (wx * 6 - 15) + 10), uy = wy * wy * wy * (wy * (wy * 6 - 15) + 10), uz = wz * wz * wz * (wz * (wz * 6 - 15) + 10);
  const dux = 30 * wx * wx * (wx * (wx - 2) + 1), duy = 30 * wy * wy * (wy * (wy - 2) + 1), duz = 30 * wz * wz * (wz * (wz - 2) + 1);
  tGrad(fx, fy, fz, 0); tGrad(fx + 1, fy, fz, 3); tGrad(fx, fy + 1, fz, 6); tGrad(fx + 1, fy + 1, fz, 9);
  tGrad(fx, fy, fz + 1, 12); tGrad(fx + 1, fy, fz + 1, 15); tGrad(fx, fy + 1, fz + 1, 18); tGrad(fx + 1, fy + 1, fz + 1, 21);
  const dot = (k, ox, oy, oz) => G[k] * (wx - ox) + G[k + 1] * (wy - oy) + G[k + 2] * (wz - oz);
  const va = dot(0, 0, 0, 0), vb = dot(3, 1, 0, 0), vc = dot(6, 0, 1, 0), vd = dot(9, 1, 1, 0);
  const ve = dot(12, 0, 0, 1), vf = dot(15, 1, 0, 1), vg = dot(18, 0, 1, 1), vh = dot(21, 1, 1, 1);
  const k1 = vb - va, k2 = vc - va, k3 = ve - va, k4 = va - vb - vc + vd, k5 = va - vc - ve + vg, k6 = va - vb - ve + vf, k7 = -va + vb + vc - vd + ve - vf - vg + vh;
  out[0] = va + ux * k1 + uy * k2 + uz * k3 + ux * uy * k4 + uy * uz * k5 + uz * ux * k6 + ux * uy * uz * k7;
  const kv = [k1, k2, k3], kyzx = [k4, k5, k6], kzxy = [k6, k4, k5];
  const u = [ux, uy, uz], du = [dux, duy, duz];
  for (let c = 0; c < 3; c++) {
    const ga = G[c], gb = G[3 + c], gc = G[6 + c], gd = G[9 + c], ge = G[12 + c], gf = G[15 + c], gg = G[18 + c], gh = G[21 + c];
    const uyzx = u[(c + 1) % 3], uzxy = u[(c + 2) % 3];
    out[1 + c] = ga + ux * (gb - ga) + uy * (gc - ga) + uz * (ge - ga) + ux * uy * (ga - gb - gc + gd) + uy * uz * (ga - gc - ge + gg)
      + uz * ux * (ga - gb - ge + gf) + ux * uy * uz * (-ga + gb + gc - gd + ge - gf - gg + gh)
      + du[c] * (kv[c] + uyzx * kyzx[c] + uzxy * kzxy[c] + uyzx * uzxy * k7);
  }
  return out;
}

// ---- the read-back mask ----
export const GMASK = { n: 0, data: null, texture: null };
/** Install a mask (Uint8Array, 6 faces of n x n RGBA stacked, row j of face f at row f*n+j). */
export function setGroundMask(data, n) {
  GMASK.n = n; GMASK.data = data;
  if (GMASK.texture) GMASK.texture.dispose();
  const t = new THREE.DataTexture(data, n, n * 6, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  GMASK.texture = t;
  return t;
}
/** Face and (u, v) of a direction, as the GLSL gmask() and the bake pass lay them out. */
export function faceUV(x, y, z, out) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) { out[0] = x >= 0 ? 0 : 1; out[1] = z / ax; out[2] = y / ax; }
  else if (ay >= az) { out[0] = y >= 0 ? 2 : 3; out[1] = x / ay; out[2] = z / ay; }
  else { out[0] = z >= 0 ? 4 : 5; out[1] = x / az; out[2] = y / az; }
  return out;
}
const _fuv = [0, 0, 0];
export function gmask(x, y, z, out) {
  const n = GMASK.n, d = GMASK.data;
  if (n < 2 || !d) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  faceUV(x, y, z, _fuv);
  const f = _fuv[0], n1 = n - 1;
  const X = Math.min(Math.max((_fuv[1] * 0.5 + 0.5) * n1, 0), n1), Y = Math.min(Math.max((_fuv[2] * 0.5 + 0.5) * n1, 0), n1);
  const x0 = Math.min(Math.floor(X), n1 - 1), y0 = Math.min(Math.floor(Y), n1 - 1);
  const fx = X - x0, fy = Y - y0;
  const o00 = ((f * n + y0) * n + x0) * 4, o10 = o00 + 4, o01 = o00 + n * 4, o11 = o01 + 4;
  for (let c = 0; c < 4; c++) {
    const t00 = d[o00 + c] / 255, t10 = d[o10 + c] / 255, t01 = d[o01 + c] / 255, t11 = d[o11 + c] / 255;
    out[c] = (t00 * (1 - fx) + t10 * fx) * (1 - fy) + (t01 * (1 - fx) + t11 * fx) * fy;
  }
  return out;
}

const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export function reliefMask(ux, uy, uz, gm) {
  const S = RELIEF.site;
  let m = smoothstep(0.3, 0.95, gm[0]);
  const lx = uz * R_MOON, lz = uy * R_MOON;
  if (ux > 0.5) {
    m *= smoothstep(S.flat0, S.flat1, Math.hypot(lx, lz));
    const qx = lx - DRV_P0[0], qz = lz - DRV_P0[1];
    const t = Math.min(Math.max(qx * DRV_D[0] + qz * DRV_D[1], 0), DRV_LEN);
    m *= smoothstep(S.drvW0, S.drvW1, Math.hypot(qx - DRV_D[0] * t, qz - DRV_D[1] * t));
    const bd = +BAY.r.toFixed(4) - Math.hypot(lx - +BAY.x.toFixed(4), lz - +BAY.z.toFixed(4));
    m *= smoothstep(S.bay0, S.bay1, -bd);
  }
  for (const T of TOWN_D) m *= smoothstep(S.town0, S.town1, Math.hypot(ux - T[0], uy - T[1], uz - T[2]) * R_MOON);
  return m;
}

const _n = new Float64Array(4), _gm = [0, 0, 0, 0];
const mulR = (R, x, y, z, s, o, out) => {       // out = R * (p / s) + o
  x /= s; y /= s; z /= s;
  out[0] = R[0] * x + R[1] * y + R[2] * z + o[0];
  out[1] = R[3] * x + R[4] * y + R[5] * z + o[1];
  out[2] = R[6] * x + R[7] * y + R[8] * z + o[2];
  return out;
};
const mulRT = (R, g, s, out) => {               // out = (g * R) / s  (R transposed times g)
  out[0] = (R[0] * g[1] + R[3] * g[2] + R[6] * g[3]) / s;
  out[1] = (R[1] * g[1] + R[4] * g[2] + R[7] * g[3]) / s;
  out[2] = (R[2] * g[1] + R[5] * g[2] + R[8] * g[3]) / s;
  return out;
};
const _q = [0, 0, 0], _d = [0, 0, 0];

/**
 * The relief (km above R_MOON) at unit direction (x, y, z), every octave (fade 0) unless a fade
 * size (km) is given; info (optional) receives { hi, valley, wood, land, water } from the mask.
 */
export function reliefH(x, y, z, fade = 0, info = null) {
  const gm = gmask(x, y, z, _gm);
  if (info) { info.land = gm[0]; info.water = gm[2]; info.wood = gm[3]; info.hi = 0; info.valley = 0; info.mask = 0; }
  const M = reliefMask(x, y, z, gm);
  if (info) info.mask = M;
  if (M <= 0) return 0;
  const Px = x * R_MOON, Py = y * R_MOON, Pz = z * R_MOON;
  const W = RELIEF.warp;
  mulR(W.rot, Px, Py, Pz, W.lam, W.off, _q); tNoise(_q[0], _q[1], _q[2], _n);
  const Pwx = Px + _n[1] * W.amp, Pwy = Py + _n[2] * W.amp, Pwz = Pz + _n[3] * W.amp;
  const Rg = RELIEF.region;
  mulR(Rg.rot, Px, Py, Pz, Rg.lam, Rg.off, _q); tNoise(_q[0], _q[1], _q[2], _n);
  const hi = Math.min(Math.max(Math.max(smoothstep(Rg.lo, Rg.hi, _n[0]), smoothstep(RELIEF.bakeHiLo, RELIEF.bakeHiHi, gm[1] * 5)), 0), 1);
  const S = RELIEF.ampLow + (1 - RELIEF.ampLow) * hi;
  const V = RELIEF.valley;
  mulR(V.rot, Pwx, Pwy, Pwz, V.lam, V.off, _q); tNoise(_q[0], _q[1], _q[2], _n);
  const av = Math.abs(_n[0]);
  const vv = 1 - smoothstep(0, V.width, av);
  let raw = RELIEF.lift * S - V.depth * S * vv * vv;
  let gx = 0, gy = 0, gz = 0;
  {
    const tv = Math.min(Math.max(av / V.width, 0), 1);
    const dsm = 6 * tv * (1 - tv) / V.width;
    mulRT(V.rot, _n, V.lam, _d);
    const k = V.depth * S * 2 * vv * dsm * Math.sign(_n[0]);
    gx += k * _d[0]; gy += k * _d[1]; gz += k * _d[2];
  }
  for (let i = 0; i < RELIEF.oct.length; i++) {
    const o = RELIEF.oct[i];
    const w = 1 - smoothstep(+(o.lam * 0.2).toFixed(5), +(o.lam * 0.45).toFixed(5), fade);
    if (w <= 0) continue;
    mulR(o.rot, Pwx, Pwy, Pwz, o.lam, o.off, _q); tNoise(_q[0], _q[1], _q[2], _n);
    mulRT(o.rot, _n, o.lam, _d);
    const rk = o.ridge * hi;
    const val = _n[0] + (0.8 - 1.6 * Math.abs(_n[0]) - _n[0]) * rk;
    const sg = -1.6 * Math.sign(_n[0]);
    let a = o.amp * S * w;
    if (i >= 2) a /= 1 + RELIEF.erosion * (gx * gx + gy * gy + gz * gz);
    if (i >= 3) a *= 1 - 0.6 * vv;
    raw += a * val;
    gx += a * (_d[0] + (sg * _d[0] - _d[0]) * rk);
    gy += a * (_d[1] + (sg * _d[1] - _d[1]) * rk);
    gz += a * (_d[2] + (sg * _d[2] - _d[2]) * rk);
  }
  const Me = RELIEF.mesa;
  mulR(Me.rot, Px, Py, Pz, Me.lam, Me.off, _q); tNoise(_q[0], _q[1], _q[2], _n);
  const mk = smoothstep(Me.lo, Me.hi, _n[0]) * hi * Me.k;
  if (mk > 0 && raw > 0) {
    const t = raw / Me.step, fl = Math.floor(t), fr = t - fl;
    const st = Math.min(Math.max((fr - 0.55) / 0.3, 0), 1);
    const ter = (fl + st * st * (3 - 2 * st)) * Me.step;
    raw = raw + (ter - raw) * mk;
  }
  const sq = Math.sqrt(raw * raw + +(RELIEF.floorK * RELIEF.floorK).toFixed(7));
  if (info) { info.hi = hi; info.valley = vv; }
  return 0.5 * (raw + sq) * M;
}
export const FLOOR_K2 = +(RELIEF.floorK * RELIEF.floorK).toFixed(7);

// ---------------------------------------------------------------------------------------------
// the read-back pass: renders the mask from the bake's cube maps, one face at a time
// ---------------------------------------------------------------------------------------------
export const GMASK_BAKE_FRAG = /* glsl */ `
uniform samplerCube uMoonA;
uniform samplerCube uMoonN;
uniform int uFace;
uniform float uN;
vec3 faceDirG(int f, float u, float v) {
  if (f == 0) return normalize(vec3(1.0, v, u));
  if (f == 1) return normalize(vec3(-1.0, v, u));
  if (f == 2) return normalize(vec3(u, 1.0, v));
  if (f == 3) return normalize(vec3(u, -1.0, v));
  if (f == 4) return normalize(vec3(u, v, 1.0));
  return normalize(vec3(u, v, -1.0));
}
float decodeHG(float a) { float s = a * 2.0 - 1.0; return sign(s) * s * s * 9.0; }
void main() {
  vec2 ij = floor(gl_FragCoord.xy);
  float n1 = uN - 1.0;
  float u = ij.x / n1 * 2.0 - 1.0, v = ij.y / n1 * 2.0 - 1.0;
  vec3 d = faceDirG(uFace, u, v);
  vec3 e1 = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(d, e1);
  float step1 = 1.4 / n1;                        // ~0.7 texel of this map, as an angle
  float wMax = textureLod(uMoonN, d, 0.0).a;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.785398;
    vec3 q = normalize(d + (e1 * cos(an) + e2 * sin(an)) * step1);
    wMax = max(wMax, textureLod(uMoonN, q, 0.0).a);
  }
  vec4 A = textureLod(uMoonA, d, 0.0);
  float h = decodeHG(A.a);
  vec3 alb = A.rgb * A.rgb;
  float bright = dot(alb, vec3(0.3, 0.5, 0.2));
  float gex = (alb.g - 0.5 * (alb.r + alb.b)) / max(bright, 1e-3);
  float wood = smoothstep(0.25, 0.55, gex) * (1.0 - smoothstep(0.035, 0.065, bright)) * (1.0 - smoothstep(1.6, 2.6, h));
  float water = textureLod(uMoonN, d, 0.0).a;
  gl_FragColor = vec4(1.0 - clamp(wMax, 0.0, 1.0), clamp(h / 5.0, 0.0, 1.0), clamp(water, 0.0, 1.0), wood * (1.0 - water));
}
`;
