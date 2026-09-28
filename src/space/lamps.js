import * as THREE from 'three';

// Running lights, berth lamps and lane beacons for the orbital view.
//
// Each lamp is a camera-facing sprite at a point on a ship or station (object space,
// any unit: the sprite reads its scale from modelViewMatrix). The sprite's drawn radius
// never falls below uMinPx, and once the lamp is smaller than that its brightness is
// scaled by the ratio of true to drawn area, so a distant lamp dims smoothly into a
// faint point instead of popping on and off as the rasteriser hits or misses it. Lamps
// are steady or breathe slowly (a sine of several seconds, never an on/off blink).
// Directional lamps (port red, starboard green) fade smoothly with the viewing angle.
//
// Rule 7: sprites whose centre is behind the camera, outside the depth slice, far off
// screen or non-finite collapse to nothing.

const VERT = /* glsl */ `
attribute vec4 iLamp;      // xyz position (object units), w radius (object units)
attribute vec4 iCol;       // rgb colour * intensity, a: phase (0..1)
attribute vec4 iDir;       // xyz facing (object space, 0 = omni), w: breathing depth (0 steady .. 1)
uniform vec2 uRes;
uniform float uMinPx;
uniform float uTime;
uniform float uGain;
uniform float uHalo;       // drawn glow radius / lamp radius
varying vec2 vQ;
varying vec3 vC;
void main() {
  vec4 c = modelViewMatrix * vec4(iLamp.xyz, 1.0);
  float s = length(modelViewMatrix[0].xyz);          // object -> view units
  float r = iLamp.w * s;
  float d = -c.z;
  vec4 clip = projectionMatrix * c;
  bool bad = !(d > r * 0.5 + 1e-6) || !(clip.w > 1e-6) || clip.z < -clip.w || clip.z > clip.w;
  vec2 ndc = clip.xy / max(clip.w, 1e-6);
  bad = bad || any(isnan(ndc)) || any(isinf(ndc)) || any(greaterThan(abs(ndc), vec2(1.2)));
  if (bad) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vQ = vec2(0.0); return; }
  float pxPerUnit = uRes.y * 0.5 * projectionMatrix[1][1] / d;
  float pxTrue = r * uHalo * pxPerUnit;
  float pxDraw = max(pxTrue, uMinPx);
  // below the minimum size the lamp dims in proportion (smooth in distance, so it never
  // pops; linear rather than by area, so harbour lights still read from far off)
  float cover = pxTrue / pxDraw;
  // a disc a pixel or two across rasterises as a plus sign: draw the sprite at least 2.6 px
  // in radius and spread the same energy over it (area ratio), so small lamps read as round dots
  float pxQuad = max(pxDraw, 2.6);
  cover *= (pxDraw * pxDraw) / (pxQuad * pxQuad);
  // facing
  float face = 1.0;
  if (dot(iDir.xyz, iDir.xyz) > 0.25) {
    vec3 dv = normalize(mat3(modelViewMatrix) * iDir.xyz);
    face = smoothstep(-0.25, 0.35, dot(dv, normalize(-c.xyz)));
  }
  float breathe = 1.0 - iDir.w * (0.5 - 0.5 * sin(6.2831853 * (uTime / 5.5 + iCol.a)));
  vC = iCol.rgb * cover * face * breathe * uGain;
  vQ = position.xy;
  // lift the sprite toward the camera so the hull it sits on never buries it
  vec3 toCam = normalize(-c.xyz);
  c.xyz += toCam * r * 1.5;
  float ext = pxQuad / pxPerUnit;
  c.xy += position.xy * ext;
  gl_Position = projectionMatrix * c;
}
`;

const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vC;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0 || vC.r + vC.g + vC.b < 1e-5) discard;
  // the skirt falls to zero at the quad's rim (no square or cross-shaped edge)
  float rim = 1.0 - r2;
  // a bright core with a soft skirt; normalised so the total stays close to the disc's
  float core = exp(-r2 * 7.0);
  float skirt = exp(-r2 * 2.2) * 0.18 * rim;
  gl_FragColor = vec4(vC * (core + skirt) * 2.4, 0.0);
}
`;

export const LAMP = {
  RED: [1.0, 0.16, 0.08],
  GREEN: [0.16, 1.0, 0.42],
  WHITE: [1.0, 0.95, 0.86],
  AMBER: [1.0, 0.6, 0.22],
  TEAL: [0.35, 0.95, 1.0],
  BLUE: [0.45, 0.7, 1.0],
};

/**
 * lamps: [{ p: Vector3, r: radius, color: [r, g, b], i: intensity, dir?: Vector3, breathe?: 0..1, phase?: 0..1 }]
 * Add the returned mesh as a child of the ship or station it belongs to.
 */
export function createLamps(lamps, { minPx = 1.5, gain = 1, halo = 2.2 } = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const n = Math.max(lamps.length, 1);
  const L = new Float32Array(n * 4), C = new Float32Array(n * 4), D = new Float32Array(n * 4);
  lamps.forEach((l, k) => {
    const i = l.i ?? 1;
    L.set([l.p.x, l.p.y, l.p.z, l.r], k * 4);
    C.set([l.color[0] * i, l.color[1] * i, l.color[2] * i, l.phase ?? ((k * 0.618034) % 1)], k * 4);
    const d = l.dir || { x: 0, y: 0, z: 0 };
    D.set([d.x, d.y, d.z, l.breathe ?? 0], k * 4);
  });
  g.setAttribute('iLamp', new THREE.InstancedBufferAttribute(L, 4));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(C, 4));
  g.setAttribute('iDir', new THREE.InstancedBufferAttribute(D, 4));
  g.instanceCount = lamps.length;
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uRes: LAMP_UNIFORMS.uRes, uMinPx: { value: minPx }, uTime: LAMP_UNIFORMS.uTime, uGain: { value: gain }, uHalo: { value: halo } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 17;
  return mesh;
}

/** Shared per-frame values (resolution, real time), updated once by the space mode. */
export const LAMP_UNIFORMS = { uRes: { value: new THREE.Vector2(1920, 1080) }, uTime: { value: 0 } };

/** Standard navigation set for a hull: port red, starboard green (facing outward), white stern. */
export function navLamps(port, starboard, stern, r, extra = []) {
  const out = [];
  if (port) out.push({ p: port, r, color: LAMP.RED, i: 3.2, dir: new THREE.Vector3(-1, 0, 0.35) });
  if (starboard) out.push({ p: starboard, r, color: LAMP.GREEN, i: 3.2, dir: new THREE.Vector3(1, 0, 0.35) });
  if (stern) out.push({ p: stern, r, color: LAMP.WHITE, i: 2.4, dir: new THREE.Vector3(0, 0, -1) });
  return out.concat(extra);
}
