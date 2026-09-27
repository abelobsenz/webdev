import * as THREE from 'three';
import { patchedMaterial, aerialShaderMaterial, FACADE_GLSL } from './materials.js';
import { latheFacade, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { createNoise2D, mulberry32 } from './noise.js';
import { U } from '../core/uniforms.js';

const n2 = createNoise2D(909);
const n3 = createNoise2D(311);

function islandGeometry(r, seed) {
  // radial parameterisation: meadow top → rounded rim → hanging root of rock
  const rnd = mulberry32(seed * 31 + 7);
  const A = 160, T = 72;
  const depth = 1.7 + rnd() * 0.9;
  const lobes = 5 + Math.floor(rnd() * 4);
  const pos = [], col = [], glow = [], idx = [];
  for (let j = 0; j <= T; j++) {
    const t = j / T;
    for (let i = 0; i <= A; i++) {
      const ang = (i / A) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const edge = 1 + 0.16 * n2(ca * 1.2 + seed, sa * 1.2) + 0.05 * n2(ca * 3.5 + seed, sa * 3.5);
      let rr, y;
      let c;
      let g = 0;
      if (t <= 0.4) {
        const s = t / 0.4;
        rr = s * edge;
        const x0 = ca * rr, z0 = sa * rr;
        y = 0.05 * n2(x0 * 1.8 + seed, z0 * 1.8) * (1 - s * s) + 0.02 * (1 - s);
        const gN = n2(x0 * 5 + seed, z0 * 5) * 0.5 + 0.5;
        c = [0.13 + 0.09 * gN, 0.27 + 0.1 * gN, 0.07 + 0.02 * gN];
      } else if (t <= 0.47) {
        const s = (t - 0.4) / 0.07;
        const a = s * Math.PI * 0.5;
        rr = edge * (1 + 0.035 * Math.sin(a));
        y = -0.1 * (1 - Math.cos(a)) ;
        c = [0.24, 0.3, 0.12];
      } else {
        const s = (t - 0.47) / 0.53;
        const lobe = Math.pow(Math.abs(Math.sin(ang * lobes * 0.5 + n2(ca + seed, sa) * 1.5)), 2);
        const drip = 0.5 + 0.5 * n2(ca * 2.5 + seed * 3, sa * 2.5);
        // columnar basalt ribs and weathered bulges break up the silhouette
        const ribs = 1 - Math.abs(n3(ang * 7 + seed, s * 1.5));
        const bulge = n2(ca * 3 + seed * 5, s * 4 + sa * 3);
        const ledge = Math.max(0, Math.sin(s * 22 + bulge * 2)) * 0.035 * (1 - s);
        // a rounded bowl of rock with ridges that hang down into jagged keels
        const bowl = Math.pow(Math.cos(s * Math.PI * 0.5), 0.7);
        const keel = Math.pow(lobe, 5) * (0.8 + 0.6 * drip);
        rr = edge * 1.035 * bowl * (1 + 0.1 * lobe * s + 0.08 * ribs * ribs + 0.07 * bulge) + ledge;
        y = -0.1 - depth * (0.42 * Math.sin(s * Math.PI * 0.5) * (0.8 + 0.4 * drip) + keel * s * s * 0.9 + 0.12 * ribs * s);
        const strata = 0.5 + 0.5 * Math.sin(y * 16 + n2(ca * 2, sa * 2) * 2);
        const moss = Math.max(0, n2(ca * 4 + seed, y * 3)) * (1 - s);
        // weathered volcanic tuff: warm ochre bands over dark basalt, moss in the damp upper reaches
        const ochre = 0.5 + 0.5 * Math.sin(y * 7 + n2(ca * 3, sa * 3) * 3);
        c = [0.34 - 0.14 * s + 0.07 * strata * ochre, 0.29 - 0.12 * s + 0.045 * strata * ochre, 0.24 - 0.1 * s + 0.02 * strata];
        const mossy = Math.min(1, moss * 1.6);
        c = [c[0] * (1 - mossy * 0.65) + 0.09 * mossy, c[1] * (1 - mossy * 0.5) + 0.16 * mossy, c[2] * (1 - mossy * 0.75) + 0.05 * mossy];
        g = Math.pow(Math.max(0, 1 - Math.abs(n3(ca * 3 + 11, y * 2.2 + sa * 3)) * 4.5), 3) * Math.min(1, s * 3);
      }
      pos.push(ca * rr * r, y * r, sa * rr * r);
      col.push(c[0], c[1], c[2]);
      glow.push(g);
    }
  }
  const cols = A + 1;
  for (let j = 0; j < T; j++) for (let i = 0; i < A; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, depth: depth * r };
}

// Sky-island rock, shaded in the island's own frame (metres): stacked volcanic strata (basalt
// with columnar joints, ochre tuff, pale ash, oxidised scoria) dipping and warping across the
// island, erosion flutes and seeps streaking down the faces, moss on every ledge and in the damp
// upper reaches, roots hanging from under the meadow rim, and a meadow of grass and wildflowers
// on top. The vertex colours still tint the result. Every layer fades to its own average with
// the pixel footprint, so the rock reads the same at 10 km as it does at arm's length.
function rockMaterial() {
  return patchedMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.38 }, {
    key: 'floatrock5',
    vertex: { pars: 'attribute float aGlow; varying float vGlow;', transform: 'vGlow = aGlow;' },
    fragment: {
      pars: /* glsl */ `
${FACADE_GLSL}
varying float vGlow;
float rkRough; float rkAO; vec3 rkBump;
vec3 rkLayer(float id) {
  float h = hash11(id * 7.13 + 0.37);
  if (h < 0.34) return vec3(0.25, 0.22, 0.19);      // basalt
  if (h < 0.56) return vec3(0.4, 0.31, 0.22);       // ochre tuff
  if (h < 0.7) return vec3(0.44, 0.39, 0.32);       // pale ash
  if (h < 0.85) return vec3(0.36, 0.26, 0.2);       // oxidised scoria
  return vec3(0.3, 0.27, 0.23);                     // grey lava
}
const vec3 RK_AVG = vec3(0.33, 0.28, 0.22);
// jointed rock: Voronoi blocks (x = distance to the nearest centre, y = distance to the
// nearest joint, both in cell units; z = block id, w = second hash for the facet tilt)
vec4 rkBlocks(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + hash22(ip + o) - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = ip + o; } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec4(d1, (sqrt(d2) - d1) * 0.5, hash12(id + 5.7), hash12(id + 9.1));
}
// strata colour at warped height sy for layers of thickness T, blended across boundaries by
// the footprint and toward the palette average once layers are below a pixel
vec3 rkStrata(float sy, float T, float fwy, float seed) {
  float x = sy / T;
  float id = floor(x), fr = x - id;
  float e = clamp(fwy / T, 0.02, 1.0);
  vec3 a = rkLayer(id + seed), b = rkLayer(id + 1.0 + seed);
  vec3 c = mix(a, b, smoothstep(1.0 - e, 1.0, fr));
  return mix(c, RK_AVG, smoothstep(0.25, 0.8, fwy / T));
}
`,
      color: /* glsl */ `
{
  vec3 p = vObjPos;
  vec3 Nw = normalize(vWNrm);
  float fw = max(length(fwidth(p)), 1e-3);
  float fwy = max(fwidth(p.y), 1e-3);
  float d1 = 1.0 - smoothstep(0.3, 1.5, fw);        // metre-scale detail resolvable
  float d2 = 1.0 - smoothstep(0.04, 0.25, fw);      // hand-scale detail
  float up = Nw.y;
  vec3 vc = diffuseColor.rgb;
  rkRough = 0.9; rkAO = 1.0; rkBump = vec3(0.0);
  float ang = atan(p.z, p.x);
  float u = ang * length(p.xz);                        // metres around the island
  float meadow = smoothstep(0.62, 0.8, up) * smoothstep(-6.0, -2.0, p.y);
  vec3 c;
  // ---- rock: the island's own painted tone (warm tuff, darker toward the keel, mossy up
  //      top) carries the colour; warped, dipping strata modulate it bed by bed
  float warp = fbm2_3(p.xz * 0.012) * 9.0 + vnoise(p.xz * 0.05) * 2.5 + p.x * 0.05;
  float sy = p.y + warp;
  vec3 bed = rkStrata(sy, 7.5, fwy, 3.0) / RK_AVG;
  vec3 rock = vc * mix(vec3(1.0), bed, 0.38);
  rock *= mix(1.0, 0.92 + 0.16 * vnoise(vec2(sy * 0.8, 1.7)), 1.0 - smoothstep(0.14, 0.42, fwy));   // beds within beds
  float thin = vnoise(vec2(sy * 3.1, u * 0.35 + 5.3));
  // 3D breakup so nothing streaks straight down a face or around it
  float blot = mix(0.5, vnoise3(p * 0.09), 1.0 - smoothstep(3.0, 9.0, fw)) * 0.6 + mix(0.5, vnoise3(p * 0.37 + 5.0), d1) * 0.4;
  rock *= 0.86 + 0.28 * blot;
  // joints: the rock is broken into blocks (a few metres, taller than wide in the basalt
  // beds), each a shade apart and each face tilted a little, with dark open joints between
  float lid = floor(sy / 7.5);
  float basalt = step(hash11((lid + 3.0) * 7.13 + 0.37), 0.34);
  vec2 bsz = mix(vec2(5.0, 1.9), vec2(1.9, 6.0), basalt);
  vec4 bk = rkBlocks(vec2(u, sy) / bsz);
  float dB = 1.0 - smoothstep(bsz.x * 0.12, bsz.x * 0.35, fw);        // blocks >= ~3 px
  float jw = 0.035, jd = bk.y * min(bsz.x, bsz.y);                    // metres to the joint
  // only some joints are open: the rest are healed and barely show, so no closed "paving"
  float open = mix(0.4, smoothstep(0.42, 0.62, vnoise(vec2(u, sy) * 0.27 + bk.z * 3.0)), dB);
  float joint = clamp(1.0 - jd / max(jw, fw), 0.0, 1.0) * min(1.0, jw / fw) * (1.0 - up * up) * open;
  rock *= mix(1.0, 0.91 + 0.18 * bk.z, dB) * (0.94 + 0.12 * mix(0.5, vnoise(vec2(u, sy) * 0.9 + bk.w * 7.0), dB));
  rock *= 1.0 - 0.5 * joint;
  vec3 tang = vec3(-sin(ang), 0.0, cos(ang));
  rkBump += (tang * (bk.z - 0.5) + vec3(0.0, bk.w - 0.5, 0.0)) * 0.2 * dB * (1.0 - smoothstep(0.1, 0.4, fw));
  float crack = joint;
  // horizontal bedding ledges: lit tops, shaded undersides
  rkBump.y += (thin - 0.5) * 0.3 * (1.0 - smoothstep(0.035, 0.1, fwy));
  // dark water stains running down from ledges and the rim, glossier while wet
  float stN = vnoise(vec2(u * 0.09 + 11.0, p.y * 0.008)) * 0.7 + vnoise(vec2(u * 0.45, p.y * 0.03)) * 0.3;
  float stain = mix(0.14, smoothstep(0.6, 0.82, stN), 1.0 - smoothstep(1.5, 5.0, fw)) * (1.0 - up) * (1.0 - smoothstep(-3.0, 0.0, p.y) * 0.5);
  rock *= 1.0 - 0.38 * stain;
  rkRough = mix(0.92, 0.72, stain);
  // micro relief of the rock face
  if (d2 > 0.0) { vec3 nd = vnoised(vec2(u, p.y) * 2.3); rkBump += vec3(-sin(ang) * nd.y, nd.z, cos(ang) * nd.y) * 0.1 * d2; }
  // moss and ferns on every ledge (upward-facing), thickest near the damp rim; pale lichen
  // rosettes on the dry faces between the stains
  float dM = 1.0 - smoothstep(3.0, 9.0, fw);
  float mossN = mix(0.5, vnoise3(p * 0.11), dM) * 0.6 + mix(0.5, vnoise3(p * 0.7 + 3.0), d1) * 0.4;
  float moss = smoothstep(0.2, 0.55, up + 0.3 * (mossN - 0.5)) + smoothstep(-22.0, -4.0, p.y) * mix(0.2, smoothstep(0.5, 0.72, mossN), dM) * 0.7;
  moss = clamp(moss, 0.0, 1.0);
  vec3 mossC = mix(vec3(0.05, 0.1, 0.03), vec3(0.15, 0.22, 0.07), mossN) * (0.8 + 0.4 * mix(0.5, vnoise3(p * 3.1), d2));
  float lichen = mix(0.1, smoothstep(0.7, 0.84, vnoise3(p * 0.5 + 9.0)), 1.0 - smoothstep(0.7, 2.2, fw)) * (1.0 - moss) * (1.0 - stain);
  rock = mix(rock, vec3(0.5, 0.49, 0.42), lichen * 0.22);
  rock = mix(rock, mossC, moss * 0.85);
  // hanging roots below the rim: dark strands of varied length
  float strand = fPulse(u + vnoise(vec2(u * 0.2, p.y * 0.1)) * 2.0, 0.9, 0.0, 0.07 + 0.08 * vnoise(vec2(u * 0.5, 2.0)), fw);
  float rootLen = 3.0 + 10.0 * vnoise(vec2(floor(u / 0.9) * 0.37, 7.0));
  float depth = -8.0 - p.y;                            // metres below the root zone's top
  float roots = strand * (1.0 - smoothstep(rootLen * 0.6, rootLen, depth)) * step(-2.0, depth);
  roots *= (1.0 - smoothstep(0.1, 0.5, up)) * smoothstep(0.45, 0.7, vnoise(vec2(u * 0.08, 3.0)));   // in clumps
  rock = mix(rock, vec3(0.15, 0.11, 0.07), roots * 0.55);
  // ---- meadow: grass, clover and wildflowers
  vec3 grass = vc * (0.85 + 0.3 * mix(0.5, vnoise(p.xz * 0.35), d1));
  grass = mix(grass, grass * vec3(1.3, 1.12, 0.78), mix(0.25, smoothstep(0.55, 0.8, vnoise(p.xz * 0.06 + 9.0)), 1.0 - smoothstep(4.0, 12.0, fw)) * 0.45);
  if (d2 > 0.0) {
    float blade = vnoise(p.xz * vec2(29.0, 7.0)) * 0.5 + vnoise(p.xz * vec2(8.0, 31.0)) * 0.5;
    grass *= mix(1.0, 0.8 + 0.4 * blade, 1.0 - smoothstep(0.004, 0.03, fw));
    rkBump += vec3(vnoised(p.xz * 4.0).y, 0.0, vnoised(p.xz * 4.0 + 3.0).y) * 0.15 * d2;
  }
  float fk = hash12(floor(p.xz / 5.0) + 7.0);
  float fl = smoothstep(0.62, 0.8, vnoise(p.xz * 1.7 + fk * 20.0)) * step(0.45, fk);
  vec3 flw = fk < 0.6 ? vec3(0.92, 0.88, 0.74) : fk < 0.75 ? vec3(0.85, 0.66, 0.1) : fk < 0.9 ? vec3(0.5, 0.35, 0.78) : vec3(0.82, 0.25, 0.35);
  grass = mix(grass, flw * 0.8, fl * mix(0.25, 0.8, d1));
  c = mix(rock, grass, meadow);
  rkRough = mix(rkRough, 0.9, meadow);
  rkAO = mix(1.0 - 0.35 * crack * d1 - 0.12 * stain, 1.0, meadow);
  diffuseColor.rgb = c;
}`,
      surface: 'roughnessFactor = rkRough;',
      normal: /* glsl */ `
{
  vec3 wb = rkBump - vWNrm * dot(rkBump, normalize(vWNrm));
  normal = normalize(normal + (viewMatrix * vec4(wb, 0.0)).xyz);
}`,
      // fill light in the rock's shade is not only sky: it has bounced off warm rock and meadow
      lights: 'reflectedLight.indirectDiffuse *= rkAO * vec3(1.1, 1.0, 0.86); reflectedLight.indirectSpecular *= rkAO;',
      emissive: /* glsl */ `
{
  float pulse = 0.6 + 0.4 * sin(uTime * 1.2 + vObjPos.y * 0.05 + vObjPos.x * 0.02);
  totalEmissiveRadiance += vec3(0.35, 0.8, 1.0) * vGlow * pulse * (0.02 + 0.16 * uCityLights);
}`,
    },
  });
}

const FALL_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FALL_FRAG = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main() {
  float x = vUv.x, y = vUv.y;            // y: 0 top -> 1 bottom
  float streak = vnoise(vec2(x * 18.0, y * 3.0 - uTime * 1.6)) * 0.6 + vnoise(vec2(x * 40.0, y * 7.0 - uTime * 2.3)) * 0.4;
  float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
  float fade = (1.0 - smoothstep(0.35, 1.0, y)) * smoothstep(0.0, 0.03, y);
  float a = edge * fade * (0.35 + 0.65 * streak);
  vec3 light = uSunColor * uSunIlluminance * max(uSunDir.y, 0.05) * 0.3 + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 0.6;
  vec3 col = vec3(0.85, 0.92, 1.0) * light;
  col += vec3(0.4, 0.8, 1.0) * uCityLights * 0.05;
  col = applyAerial(col, vW);
  gl_FragColor = vec4(col * a, a * 0.85);
}`;

const MIST_VERT = /* glsl */ `
uniform float uTime;
attribute float aSeed;
uniform float uSize;
varying float vA; varying vec3 vW;
void main() {
  vec3 p = position;
  float t = fract(uTime * 0.04 + aSeed);
  p.y -= t * 60.0;
  p.xz += vec2(sin(aSeed * 40.0 + uTime * 0.2), cos(aSeed * 31.0 + uTime * 0.17)) * t * 30.0;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + t) / -mv.z * 800.0;
  vA = sin(t * 3.14159) * 0.22;
}`;
const MIST_FRAG = /* glsl */ `
varying float vA; varying vec3 vW;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = (1.0 - d) * vA;
  if (a <= 0.0) discard;
  vec3 light = uSunColor * uSunIlluminance * max(uSunDir.y, 0.05) * 0.25 + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 0.7;
  vec3 col = applyAerial(vec3(0.9, 0.95, 1.0) * light, vW);
  gl_FragColor = vec4(col * a, a * 0.6);
}`;

function glowRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCityLights: U.uCityLights },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-w.xyz); vP = position; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform float uTime; uniform float uCityLights; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = atan(vP.z, vP.x); float run = pow(fract(a / 6.2831 * 3.0 - uTime * 0.25), 6.0); vec3 c = vec3(0.4, 0.85, 1.0) * (0.25 + 0.75 * uCityLights) * (0.25 + 1.4 * run) * f; gl_FragColor = vec4(c, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function buildFloatingIslands(defs, scene, treeField) {
  const rockMat = rockMaterial();
  const fallMat = aerialShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const mistMat = aerialShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { uSize: { value: 22 } }, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const ringMat = glowRingMaterial();
  const pavMat = createFacadeMaterial('pearl', 300, { litFrac: 0.8 });
  const islands = [];
  const treeLists = [];
  for (const d of defs) {
    const rnd = mulberry32(d.seed * 97);
    const group = new THREE.Group();
    group.position.set(d.x, d.y, d.z);
    group.rotation.y = rnd() * Math.PI * 2;
    scene.add(group);
    const { geo, depth } = islandGeometry(d.r, d.seed);
    const rock = new THREE.Mesh(geo, rockMat);
    rock.castShadow = true; rock.receiveShadow = true;
    group.add(rock);
    // levitation ring beneath
    const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.42, d.r * 0.025, 8, 96), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -depth * 0.55;
    group.add(ring);
    // pavilion: a floating disc roof on a slender stem
    const pr = d.r * (0.16 + rnd() * 0.08);
    const pav = new THREE.Mesh(mergeClean([
      latheFacade([{ r: pr * 1.1, y: 0, kind: 1 }, { r: pr * 1.1, y: 2, kind: 3 }, { r: pr * 0.5, y: 2.2, kind: 1 }, { r: pr * 0.45, y: 14, kind: 0 }, { r: pr * 1.6, y: 16, kind: 2 }, { r: pr * 1.7, y: 18, kind: 1 }, { r: pr * 0.4, y: 22, kind: 1 }, { r: 0.2, y: 23, kind: 1 }], 32),
    ]), pavMat);
    pav.position.set((rnd() - 0.5) * d.r * 0.4, d.r * 0.05, (rnd() - 0.5) * d.r * 0.4);
    pav.castShadow = true;
    group.add(pav);
    // waterfalls from the rim
    const falls = 1 + Math.floor(rnd() * 2);
    for (let f = 0; f < falls; f++) {
      const a = rnd() * Math.PI * 2;
      const rimR = d.r * 0.95;
      const h = d.y * (0.55 + rnd() * 0.25);
      const w = d.r * (0.07 + rnd() * 0.05);
      const pts = [];
      const segs = 24;
      const pos = [], uv = [], idx = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const out = rimR + 6 + Math.sqrt(t) * 26;
        const y = d.r * 0.03 - t * h;
        for (const side of [-1, 1]) {
          const tang = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
          const spread = w * (1 + t * 1.2);
          pos.push(Math.cos(a) * out + tang.x * side * spread, y, Math.sin(a) * out + tang.z * side * spread);
          uv.push(side < 0 ? 0 : 1, t);
        }
        if (s < segs) { const k = s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(idx);
      const fall = new THREE.Mesh(fg, fallMat);
      fall.renderOrder = 2;
      group.add(fall);
      // mist cloud where the water dissolves into the air
      const mcount = 70;
      const mp = new Float32Array(mcount * 3), ms = new Float32Array(mcount);
      const my = d.r * 0.03 - h * 0.62;
      for (let k = 0; k < mcount; k++) {
        const out = rimR + 20 + rnd() * 20;
        mp[k * 3] = Math.cos(a) * out + (rnd() - 0.5) * w * 3; mp[k * 3 + 1] = my + (rnd() - 0.5) * 40; mp[k * 3 + 2] = Math.sin(a) * out + (rnd() - 0.5) * w * 3;
        ms[k] = rnd();
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
      const mist = new THREE.Points(mg, mistMat);
      mist.frustumCulled = false;
      mist.renderOrder = 3;
      group.add(mist);
    }
    // trees on the meadow (local coordinates, attached to the island)
    const trees = [];
    const nt = Math.floor(d.r * d.r * 0.0075);
    for (let k = 0; k < nt; k++) {
      const rr = Math.sqrt(rnd()) * d.r * 0.82, aa = rnd() * Math.PI * 2;
      const x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
      if (Math.hypot(x - pav.position.x, z - pav.position.z) < pr * 2.2) continue;
      trees.push({ x, y: d.r * 0.02, z, s: 9 + rnd() * 9, sp: rnd() < 0.5 ? 2 : rnd() < 0.5 ? 3 : 1, rot: rnd() * 6.28, tint: [0.9 + rnd() * 0.2, 0.9 + rnd() * 0.25, 0.85 + rnd() * 0.2] });
    }
    treeLists.push({ group, trees });
    islands.push({ group, def: d, base: group.position.clone(), phase: rnd() * 10, depth });
  }
  return {
    islands,
    treeLists,
    update(dt, t) {
      for (const i of islands) {
        i.group.position.y = i.base.y + Math.sin(t * 0.25 + i.phase) * 2.5;
        i.group.rotation.y += dt * 0.004;
      }
    },
  };
}
