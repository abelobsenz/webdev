import * as THREE from 'three';
import { patchedMaterial } from './materials.js';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { mulberry32 } from './noise.js';
import { ST } from './urban.js';

// Street furniture: lamps on every verge, benches along the esplanades and avenues,
// and a centrepiece in every civic and village square.

const TAU = Math.PI * 2;

function lampGeometry() {
  // bronze post with a disc luminaire ("lotus" head); aPart 1 = diffuser
  const post = latheFacade([
    { r: 0.24, y: 0 }, { r: 0.22, y: 0.3 }, { r: 0.12, y: 0.42 }, { r: 0.1, y: 0.9 }, { r: 0.075, y: 3.6 }, { r: 0.06, y: 5.1 },
    { r: 0.1, y: 5.25 }, { r: 0.52, y: 5.5 }, { r: 0.54, y: 5.56 },
  ], 10);
  const head = latheFacade([{ r: 0.54, y: 5.56 }, { r: 0.44, y: 5.5 }, { r: 0.1, y: 5.42 }, { r: 0.02, y: 5.42 }], 10);
  const top = latheFacade([{ r: 0.54, y: 5.56 }, { r: 0.4, y: 5.66 }, { r: 0.12, y: 5.72 }, { r: 0.01, y: 5.8 }], 10);
  const parts = [[post, 0], [head, 1], [top, 0]];
  for (const [g, k] of parts) {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(k), 1));
    g.deleteAttribute('aFacade');
  }
  return mergeParts(parts.map(([g]) => g));
}

function mergeParts(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), part = new Float32Array(nv), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, ov * 3);
    nrm.set(g.attributes.normal.array, ov * 3);
    part.set(g.attributes.aPart.array, ov);
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
    ov += g.attributes.position.count; oi += I.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function lampMaterial() {
  return patchedMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.85, envMapIntensity: 0.9 }, {
    key: 'streetlamp2',
    vertex: {
      pars: 'attribute float aPart; varying float vPart; varying float vLampSeed;',
      transform: /* glsl */ `
vPart = aPart;
#ifdef USE_INSTANCING
vLampSeed = fract(instanceMatrix[3].x * 0.0137 + instanceMatrix[3].z * 0.0071);
if (distance(instanceMatrix[3].xyz, cameraPosition) > 1400.0) transformed *= 0.0;
#else
vLampSeed = 0.5;
#endif
`,
    },
    fragment: {
      pars: 'varying float vPart; varying float vLampSeed; float lpRough; float lpMetal;',
      color: /* glsl */ `
{
  // cast bronze, brushed along the post, a verdigris bloom toward the foot; opal diffuser
  vec2 rd = vObjPos.xz / max(length(vObjPos.xz), 1e-4);               // seam-free round the post
  float br = vnoise3(vec3(rd * 1.0, vObjPos.y * 40.0));
  float pat = smoothstep(0.55, 0.85, vnoise3(vec3(rd * 0.35, vObjPos.y * 3.0) + vLampSeed * 9.0)) * (1.0 - smoothstep(0.2, 1.6, vObjPos.y));
  vec3 bronze = vec3(0.22, 0.17, 0.12) * (0.85 + 0.3 * br);
  bronze = mix(bronze, vec3(0.2, 0.3, 0.26), pat * 0.7);
  diffuseColor.rgb = mix(bronze, vec3(0.92, 0.9, 0.86), vPart);
  lpRough = mix(0.32 + 0.12 * br + 0.35 * pat, 0.6, vPart);
  lpMetal = mix(0.85 * (1.0 - pat * 0.8), 0.0, vPart);
}`,
      surface: 'roughnessFactor = lpRough; metalnessFactor = lpMetal;',
      emissive: /* glsl */ `
{
  vec3 warm = mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.82, 0.62), vLampSeed);
  #ifdef USE_COLOR
  warm = mix(warm, vColor.rgb * 1.1, 0.8);    // a district's own light (the Outer Wards)
  #endif
  // the diffuser glows brightest in a ring round its centre
  float rr = length(vObjPos.xz);
  float rq = (rr - 0.3) / 0.12;
  float ringG = 0.7 + 0.5 * exp(-rq * rq);
  totalEmissiveRadiance += warm * vPart * uCityLights * 2.6 * ringG;
}`,
    },
  });
}

function benchGeometry() {
  // stone plinths with a slatted timber seat and back, 2.2 m long
  const parts = [];
  const box = (x0, x1, y0, y1, z0, z1, kind) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.attributes.position;
    const fac = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { fac[i * 3] = p.getX(i) + p.getZ(i); fac[i * 3 + 1] = p.getY(i); fac[i * 3 + 2] = kind; }
    g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
    parts.push(g);
  };
  for (const x of [-0.85, 0.85]) box(x - 0.14, x + 0.14, 0, 0.42, -0.25, 0.25, 1);
  for (let k = 0; k < 4; k++) box(-1.1, 1.1, 0.42, 0.47, -0.26 + k * 0.13, -0.16 + k * 0.13, 8);
  for (let k = 0; k < 3; k++) box(-1.1, 1.1, 0.62 + k * 0.13, 0.72 + k * 0.13, -0.33, -0.28, 8);
  for (const x of [-0.85, 0.85]) box(x - 0.05, x + 0.05, 0.42, 1.0, -0.36, -0.28, 10);
  return mergeClean(parts);
}

function fountainGeometry(R) {
  // tiered basin with a bronze armillary sphere
  const parts = [];
  parts.push(latheFacade([
    { r: R, y: 0, kind: 1 }, { r: R, y: 0.55, kind: 1 }, { r: R - 0.5, y: 0.6, kind: 1 }, { r: R - 0.5, y: 0.35, kind: 6 }, { r: 1.4, y: 0.35, kind: 6 },
    { r: 1.2, y: 0.4, kind: 1 }, { r: 0.8, y: 2.2, kind: 1 }, { r: 2.6, y: 2.4, kind: 1 }, { r: 2.4, y: 2.55, kind: 6 }, { r: 0.6, y: 2.55, kind: 6 },
    { r: 0.5, y: 4.2, kind: 1 }, { r: 0.9, y: 4.4, kind: 1 }, { r: 0.05, y: 4.5, kind: 1 },
  ], 40));
  const c = new THREE.Vector3(0, 7.8, 0);
  const ring = (axis, tilt, r, t) => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      const v = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), axis).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt).add(c);
      pts.push(v);
    }
    parts.push(sweepTube(pts, () => t, 6, { kind: 10 }));
  };
  ring(0, 0, 3.4, 0.09); ring(Math.PI / 2, 0, 3.4, 0.09); ring(0, Math.PI / 2, 3.4, 0.09);
  ring(0, Math.PI / 2 - 0.41, 3.1, 0.18);                  // the ecliptic band, wider
  ring(Math.PI / 4, 0.2, 2.7, 0.06);
  parts.push(sweepTube([new THREE.Vector3(0, 4.4, 0), new THREE.Vector3(0, 11.6, 0)], () => 0.07, 6, { kind: 10 }));
  parts.push(latheFacade([{ r: 0.001, y: 7.2, kind: 2 }, { r: 0.6, y: 7.8, kind: 2 }, { r: 0.001, y: 8.4, kind: 2 }], 12));
  return mergeClean(parts);
}

function obeliskGeometry() {
  return mergeClean([
    latheFacade([{ r: 3.2, y: 0, kind: 1 }, { r: 3.2, y: 0.5, kind: 1 }, { r: 2.9, y: 0.5, kind: 6 }, { r: 1.3, y: 0.5, kind: 6 }, { r: 1.3, y: 1.4, kind: 1 }, { r: 1.0, y: 1.4, kind: 1 }], 32),
    latheFacade([{ r: 0.75, y: 1.4, kind: 1 }, { r: 0.45, y: 9.5, kind: 1 }, { r: 0.001, y: 10.4, kind: 2 }], 4, { phase: Math.PI / 4 }),
  ]);
}

export function buildStreetscape(scene, plan, ground, extraLamps = []) {
  const rnd = mulberry32(777);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const out = { meshes: [] };

  // ---- lamps
  const lamps = [...plan.lamps.map((l) => ({ ...l, y: (l.y ?? ground(l.x, l.z)) - 0.1 })), ...extraLamps];
  const lampMesh = new THREE.InstancedMesh(lampGeometry(), lampMaterial(), lamps.length);
  lamps.forEach((l, i) => { q.setFromAxisAngle(up, l.yaw || 0); m4.compose(new THREE.Vector3(l.x, l.y, l.z), q, one); lampMesh.setMatrixAt(i, m4); });
  lampMesh.instanceMatrix.needsUpdate = true;
  if (lamps.some((l) => l.tint)) {
    const c = new THREE.Color();
    lamps.forEach((l, i) => { if (l.tint) c.setRGB(l.tint[0], l.tint[1], l.tint[2]); else c.setRGB(1, 0.78, 0.55); lampMesh.setColorAt(i, c); });
    lampMesh.instanceColor.needsUpdate = true;
  }
  lampMesh.castShadow = false; lampMesh.receiveShadow = true;
  lampMesh.layers.set(1);
  lampMesh.frustumCulled = false;
  scene.add(lampMesh);
  out.meshes.push(lampMesh);
  out.lamps = lamps;

  // ---- benches along esplanades and avenues, and round the squares
  const benches = [];
  for (const st of plan.streets) {
    if (st.cls !== ST.ESPLANADE && st.cls !== ST.AVENUE) continue;
    const P = st.pts;
    let acc = 12, k = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
      const L = Math.hypot(dx, dz);
      acc += L;
      while (acc >= 34) {
        acc -= 34;
        const t = 1 - acc / L;
        const x = P[i - 1][0] + dx * t, z = P[i - 1][1] + dz * t;
        const nx = -dz / L, nz = dx / L;
        const side = (k++ & 1) ? 1 : -1;
        const off = st.hw + 2.2;
        const bx = x + nx * off * side, bz = z + nz * off * side;
        // clear of lamps and kerbs, not in squares
        if (plan.field.edge(bx, bz) < 1.6 || plan.field.squareAt(bx, bz) > 0.05) continue;
        if (lamps.some((l) => Math.abs(l.x - bx) < 3 && Math.hypot(l.x - bx, l.z - bz) < 2.5)) continue;
        // bench faces the street: its back (-z local) away from the kerb
        benches.push({ x: bx, z: bz, yaw: Math.atan2(-nx * side, -nz * side) });
      }
    }
  }
  const centres = [];
  for (const sq of plan.squares) {
    if (sq.kind !== 'civic' && sq.kind !== 'village' && sq.kind !== 'landing') continue;
    if (sq.kind !== 'landing') centres.push(sq);
    const n = Math.max(4, Math.floor((TAU * sq.r * 0.6) / 9));
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * TAU;
      const r = sq.kind === 'landing' ? sq.r - 5 : sq.r * 0.6;
      const x = sq.x + Math.cos(a) * r, z = sq.z + Math.sin(a) * r;
      if (ground(x, z) < 1.2) continue;
      benches.push({ x, z, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI });
    }
  }
  const furnMat = createFacadeMaterial('sand', 510, { litFrac: 0, uplight: 0 });
  const benchMesh = new THREE.InstancedMesh(benchGeometry(), furnMat, Math.max(1, benches.length));
  benches.forEach((b, i) => { q.setFromAxisAngle(up, b.yaw); m4.compose(new THREE.Vector3(b.x, ground(b.x, b.z) - 0.05, b.z), q, one); benchMesh.setMatrixAt(i, m4); });
  benchMesh.count = benches.length;
  benchMesh.instanceMatrix.needsUpdate = true;
  benchMesh.receiveShadow = true;
  benchMesh.layers.set(1);
  benchMesh.frustumCulled = false;
  scene.add(benchMesh);
  out.meshes.push(benchMesh);
  out.benches = benches;

  // ---- square centrepieces
  const parts = [];
  for (const sq of centres) {
    const g = sq.kind === 'civic' ? fountainGeometry(Math.min(11, sq.r * 0.3)) : obeliskGeometry();
    const rot = rnd() * TAU;
    g.rotateY(rot);
    g.translate(sq.x, ground(sq.x, sq.z) - 0.1, sq.z);
    parts.push(g);
  }
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeClean(parts), createFacadeMaterial('bronze', 511, { litFrac: 0, uplight: 1 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    out.meshes.push(mesh);
  }
  return out;
}
