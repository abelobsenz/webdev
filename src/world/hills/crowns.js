import * as THREE from 'three';
import { patchedMaterial } from '../materials.js';

// Closed, smooth-shaded tree prototypes for the hill woods beyond the detailed near trees:
// a mid set (about a hundred triangles: a lumpy lathe crown over a capped trunk) drawn from
// the near radius out to MID_R, and a far set (a dozen to two dozen triangles, crown only)
// drawn beyond it. Every prototype is one or two closed, outward-wound lathes of unit height
// (the instance scales it to the tree), with aPart (0 trunk, 1 crown) and aCy (-1 at the
// crown's foot .. 1 at its top) for shading.

export const SHAPE = { ROUND: 0, UMBRELLA: 1, CONE: 2, FERN: 3, COLUMN: 4 };
// species index (treeGeometry.js SPECIES) -> shape, and the species' crown width (x height)
export const SHAPE_OF = [0, 0, 1, 1, 3, 3, 4, 0, 1, 2, 3];
const PROTO_W = [0.62, 1.5, 0.4, 0.95, 0.5];
export const WIDTH_OF = [0.62, 0.58, 1.55, 1.35, 0.6, 1.0, 0.5, 1.05, 1.6, 0.38, 1.0];
export const widthScale = (sp) => WIDTH_OF[sp] / PROTO_W[SHAPE_OF[sp]];

const h1 = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

/**
 * A closed lathe from a profile [[r, y], ...] that starts and ends on the axis (r = 0),
 * seg sides; lumps displace the rings. Returns arrays (non-indexed triangles are avoided:
 * indexed with shared ring vertices so the normals are smooth).
 */
function lathe(profile, seg, part, { lump = 0, seed = 1, crownY = null } = {}) {
  const pos = [], idx = [], aPart = [], aCy = [];
  const y0 = crownY ? crownY[0] : profile[0][1], y1 = crownY ? crownY[1] : profile[profile.length - 1][1];
  const ring = [];
  profile.forEach(([r, y], k) => {
    if (r === 0) { ring.push([pos.length / 3]); pos.push(0, y, 0); aPart.push(part); aCy.push(((y - y0) / (y1 - y0)) * 2 - 1); return; }
    const ids = [];
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2 + (k % 2) * (Math.PI / seg) * 0.5;
      const l = 1 + lump * (h1(seed * 31 + k * 7 + s * 3.1) - 0.5) * 2;
      ids.push(pos.length / 3);
      pos.push(Math.cos(a) * r * l, y + lump * r * 0.25 * (h1(seed * 17 + k * 5 + s) - 0.5), Math.sin(a) * r * l);
      aPart.push(part); aCy.push(((y - y0) / (y1 - y0)) * 2 - 1);
    }
    ring.push(ids);
  });
  // wound so the faces look outward (down the profile, counter-clockwise from outside)
  for (let k = 0; k < ring.length - 1; k++) {
    const A = ring[k], B = ring[k + 1];
    if (A.length === 1) { for (let s = 0; s < seg; s++) idx.push(A[0], B[s], B[(s + 1) % seg]); continue; }
    if (B.length === 1) { for (let s = 0; s < seg; s++) idx.push(A[s], B[0], A[(s + 1) % seg]); continue; }
    for (let s = 0; s < seg; s++) {
      const a = A[s], b = A[(s + 1) % seg], c = B[s], d = B[(s + 1) % seg];
      idx.push(a, d, b, a, c, d);
    }
  }
  return { pos, idx, aPart, aCy };
}

function merge(parts) {
  const pos = [], idx = [], aPart = [], aCy = [];
  for (const p of parts) {
    const o = pos.length / 3;
    pos.push(...p.pos); aPart.push(...p.aPart); aCy.push(...p.aCy);
    for (const i of p.idx) idx.push(i + o);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(aPart, 1));
  g.setAttribute('aCy', new THREE.Float32BufferAttribute(aCy, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the axis poles: straight up / down (computeVertexNormals averages the fan; keep it exact)
  g.computeBoundingSphere();
  return g;
}

const trunk = (top, r, seg = 5) => lathe([[0, -0.03], [r * 1.25, -0.03], [r, top * 0.5], [r * 0.7, top], [0, top]], seg, 0);

let _mid = null, _far = null;
/** Mid prototypes by SHAPE (unit height). */
export function midPrototypes() {
  if (_mid) return _mid;
  const S = 9;
  _mid = [
    // ROUND: a broadleaf crown from 0.42 of the height
    merge([trunk(0.62, 0.022), lathe([[0, 0.4], [0.17, 0.43], [0.27, 0.5], [0.31, 0.61], [0.3, 0.73], [0.23, 0.86], [0.12, 0.96], [0, 1.0]], S, 1, { lump: 0.14, seed: 1 })]),
    // UMBRELLA: a wide, flat-topped canopy (rain tree, flame tree)
    merge([trunk(0.5, 0.03), lathe([[0, 0.33], [0.42, 0.37], [0.7, 0.46], [0.75, 0.56], [0.62, 0.68], [0.36, 0.78], [0, 0.82]], S + 2, 1, { lump: 0.12, seed: 2 })]),
    // CONE: tiered conifer (the Norfolk pines of the crests)
    merge([trunk(0.9, 0.016), lathe([[0, 0.1], [0.2, 0.14], [0.12, 0.34], [0.17, 0.36], [0.08, 0.58], [0.13, 0.6], [0.05, 0.8], [0.08, 0.82], [0, 1.0]], 8, 1, { lump: 0.08, seed: 3, crownY: [0.1, 1.0] })]),
    // FERN: a small spreading crown on a slim stem (tree ferns, palms)
    merge([trunk(0.82, 0.02), lathe([[0, 0.74], [0.3, 0.76], [0.47, 0.84], [0.36, 0.93], [0, 0.97]], 8, 1, { lump: 0.2, seed: 4 })]),
    // COLUMN: a tall clump (bamboo)
    merge([trunk(0.3, 0.03), lathe([[0, 0.06], [0.14, 0.12], [0.25, 0.35], [0.24, 0.62], [0.15, 0.86], [0, 1.0]], 8, 1, { lump: 0.16, seed: 5 })]),
  ];
  return _mid;
}
/** Far prototypes by SHAPE: crowns only, 6 sides (the trunks are sub-pixel there). */
export function farPrototypes() {
  if (_far) return _far;
  // (two rings of five: 20 triangles a crown; a far crown is a few pixels across)
  _far = [
    merge([lathe([[0, 0.42], [0.29, 0.52], [0.27, 0.78], [0, 1.0]], 5, 1)]),
    merge([lathe([[0, 0.34], [0.68, 0.44], [0.52, 0.68], [0, 0.82]], 5, 1)]),
    merge([lathe([[0, 0.1], [0.19, 0.16], [0.1, 0.5], [0, 1.0]], 5, 1, { crownY: [0.1, 1.0] })]),
    merge([lathe([[0, 0.72], [0.45, 0.8], [0.3, 0.92], [0, 0.97]], 5, 1)]),
    merge([lathe([[0, 0.06], [0.24, 0.3], [0.18, 0.75], [0, 1.0]], 5, 1)]),
  ];
  return _far;
}

const FADE_GLSL = /* glsl */ `
float hwIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/**
 * Crown material. mode 'mid': fades in past the near radius (the complement of the detailed
 * trees' dither) and out at uMidR; mode 'far': fades in at uMidR and thins with distance
 * (instances whose aRank exceeds the keep fraction drop out; the rest grow to keep the cover).
 */
export function crownMaterial(mode, U) {
  const far = mode === 'far';
  return patchedMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 }, {
    key: far ? 'hillCrownFar1' : 'hillCrownMid1',
    uniforms: U,
    vertex: {
      pars: `attribute float aPart; attribute float aCy; ${far ? 'attribute float aRank;' : ''}
uniform float uNearR; uniform float uBand; uniform float uMidR; uniform float uMidBand; uniform float uThin0; uniform float uThin1; uniform float uKeep1;
varying float vFadeA; varying float vFadeB; varying float vPart; varying float vCy;`,
      transform: /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  #else
  vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float d = distance(ip, cameraPosition);
  vPart = aPart; vCy = aCy;
  ${far ? `
  vFadeA = smoothstep(uMidR - uMidBand, uMidR, d);
  vFadeB = 1.0;
  float keep = mix(1.0, uKeep1, smoothstep(uThin0, uThin1, d));
  if (aRank > keep) vFadeA = 0.0;
  transformed *= mix(1.0, inversesqrt(max(keep, 0.05)), 0.85);
  ` : `
  vFadeA = smoothstep(uNearR - uBand, uNearR, d);
  vFadeB = 1.0 - smoothstep(uMidR - uMidBand, uMidR, d);
  // the crowns sway a little in the wind
  float ph = dot(ip.xz, vec2(0.031, 0.023));
  vec2 wd = normalize(uWind + vec2(1e-4));
  transformed.xz += wd * sin(uTime * 1.05 + ph) * 0.004 * max(aCy + 1.0, 0.0) * aPart;
  `}
  if (vFadeA <= 0.0 || vFadeB <= 0.0) transformed *= 0.0;
}`,
    },
    fragment: {
      pars: `varying float vFadeA; varying float vFadeB; varying float vPart; varying float vCy; float tCrownAO; ${FADE_GLSL}`,
      color: /* glsl */ `
{
  float ig = hwIgn(gl_FragCoord.xy);
  if (ig < 1.0 - vFadeA || ig >= vFadeB) discard;
  if (vPart < 0.5) {
    diffuseColor.rgb = vec3(0.15, 0.12, 0.09) * (0.8 + 0.4 * vnoise(vWPos.xz * 3.0 + vWPos.y));
    tCrownAO = 0.7;
  } else {
    // leaf masses: two scales of mottling (faded to their mean with the pixel footprint)
    float fw = length(fwidth(vWPos));
    float n = vnoise(vWPos.xz * 0.8 + vWPos.y * 0.9) * 0.6 + vnoise(vWPos.xz * 2.7 - vWPos.y * 2.1) * 0.4;
    n = mix(n, 0.5, smoothstep(0.6, 2.5, fw));
    diffuseColor.rgb *= 0.74 + 0.52 * n;
    tCrownAO = mix(0.5, 1.0, smoothstep(-0.9, 0.75, vCy)) * (0.78 + 0.22 * n);
  }
}`,
      surface: 'roughnessFactor = vPart < 0.5 ? 0.92 : 0.8;',
      lights: /* glsl */ `
reflectedLight.indirectDiffuse *= tCrownAO;
reflectedLight.indirectSpecular *= tCrownAO * 0.6;
reflectedLight.directDiffuse *= mix(1.0, tCrownAO, 0.35);
reflectedLight.directSpecular *= 0.5;`,
    },
  });
}
