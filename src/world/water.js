import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { AERIAL_GLSL } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { mulberry32 } from './noise.js';
import { INNER } from './terrain.js';

/** Tileable wave-normal texture from a sum of integer-wavenumber waves (Phillips-like spectrum). */
function createWaveNormalTexture(size = 256, seed = 5) {
  const rnd = mulberry32(seed);
  const waves = [];
  for (let i = 0; i < 64; i++) {
    const k = 1 + Math.floor(Math.pow(rnd(), 1.6) * 22);
    const a = rnd() * Math.PI * 2;
    // bias directions toward the wind (+x) but keep some cross-sea
    const dirA = (rnd() < 0.7) ? (a * 0.35 - 0.6) : a;
    const kx = Math.round(Math.cos(dirA) * k), kz = Math.round(Math.sin(dirA) * k);
    if (kx === 0 && kz === 0) continue;
    const kl = Math.hypot(kx, kz);
    waves.push({ kx, kz, amp: 1 / Math.pow(kl, 1.35), ph: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      let dx = 0, dz = 0, h = 0;
      for (const w of waves) {
        const ph = (w.kx * u + w.kz * v) * Math.PI * 2 + w.ph;
        const s = Math.sin(ph), c = Math.cos(ph);
        h += w.amp * s;
        dx += w.amp * c * w.kx; dz += w.amp * c * w.kz;
      }
      const k = (j * size + i) * 4;
      data[k] = Math.max(0, Math.min(255, 128 + dx * 5.5));
      data[k + 1] = Math.max(0, Math.min(255, 128 + dz * 5.5));
      data[k + 2] = Math.max(0, Math.min(255, 128 + h * 40));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
uniform mat4 uReflMatrix;
varying vec3 vWorld;
varying vec4 vReflCoord;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vReflCoord = uReflMatrix * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
${AERIAL_GLSL}
uniform float uTime;
uniform vec3 uSunColor;
uniform float uCityLights;
uniform sampler2D uWaveTex;
uniform sampler2D uReflection;
uniform float uHasReflection;
uniform sampler2D uInfo;
uniform float uInfoHalf;
uniform vec2 uWind;
varying vec3 vWorld;
varying vec4 vReflCoord;

vec2 waveSample(vec2 p, float scale, vec2 vel) {
  return texture(uWaveTex, p / scale + vel * uTime / scale).xy * 2.0 - 1.0;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // water depth from the baked terrain info
  vec2 iuv = (vWorld.xz + uInfoHalf) / (2.0 * uInfoHalf);
  float terrainH = -150.0;
  if (all(greaterThan(iuv, vec2(0.0))) && all(lessThan(iuv, vec2(1.0)))) terrainH = texture(uInfo, iuv).r;
  float depth = max(-terrainH, 0.0);
  if (terrainH > 0.25) discard;
  float r = length(vWorld.xz);
  float ocean = smoothstep(5200.0, 7200.0, r);
  float shallowCalm = smoothstep(0.0, 6.0, depth);

  // --- normals: layered scrolling wave maps, filtered with distance ---
  vec2 p = vWorld.xz;
  float fade1 = 1.0 - smoothstep(300.0, 2500.0, dist);
  float fade2 = 1.0 - smoothstep(40.0, 400.0, dist);
  vec2 n = vec2(0.0);
  float swell = mix(0.35, 1.0, ocean);
  n += waveSample(p, 180.0, vec2(1.6, 0.4)) * 0.55 * swell;
  n += waveSample(p.yx * vec2(1.0, -1.0), 57.0, vec2(-0.9, 1.1)) * 0.45;
  n += waveSample(p, 17.0, vec2(0.6, -0.8)) * 0.35 * fade1;
  n += waveSample(p.yx, 5.3, vec2(-0.4, -0.5)) * 0.22 * fade2;
  n *= mix(0.25, 1.0, shallowCalm);
  float strength = mix(0.09, 0.22, ocean);
  vec3 N = normalize(vec3(-n.x * strength, 1.0, -n.y * strength));
  // flatten normals toward the horizon to avoid sparkle aliasing
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(3000.0, 20000.0, dist) * 0.8));

  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

  // --- reflection ---
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl;
  vec3 skyRefl = skyRadiance(uSkyViewLUT, Rg + max(cameraPosition.y * 0.001, 0.002), vec3(0.0, 1.0, 0.0), normalize(R), uSunDir) * uSunIlluminance + uNightAmbient;
  if (uHasReflection > 0.5) {
    vec2 ruv = vReflCoord.xy / vReflCoord.w;
    ruv += N.xz * mix(0.05, 0.012, smoothstep(50.0, 3000.0, dist));
    refl = texture(uReflection, clamp(ruv, 0.001, 0.999)).rgb;
  } else {
    refl = skyRefl;
  }

  // --- sun glitter (GGX) ---
  vec3 H = normalize(V + uSunDir);
  float NdH = max(dot(N, H), 0.0);
  float rough = mix(0.035, 0.09, ocean) + smoothstep(500.0, 8000.0, dist) * 0.08;
  float a2 = rough * rough;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  float NdL = max(dot(N, uSunDir), 0.0);
  vec3 spec = uSunColor * uSunIlluminance * D * F * NdL * 0.25 / max(cosT, 0.1);
  spec = min(spec, vec3(900.0));

  // --- water body: absorption over the path to the bottom + in-water scattering ---
  float path = depth / max(cosT, 0.15);
  vec3 absorb = vec3(0.30, 0.055, 0.030);
  vec3 Tw = exp(-absorb * path * 1.2);
  vec3 sunIrr = uSunColor * uSunIlluminance * max(uSunDir.y, 0.0);
  vec3 skyIrr = skyRadiance(uSkyViewLUT, Rg + 0.002, vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), uSunDir) * uSunIlluminance * 3.0 + uNightAmbient * 4.0;
  vec3 scatterCol = mix(vec3(0.0, 0.10, 0.12), vec3(0.0, 0.035, 0.07), ocean);
  vec3 body = scatterCol * (sunIrr * 0.06 + skyIrr * 0.12);
  // turquoise glow over sandy shallows
  body += vec3(0.02, 0.16, 0.14) * (1.0 - smoothstep(0.5, 9.0, depth)) * (sunIrr * 0.03 + skyIrr * 0.04);

  // --- foam: shorelines and sparse ocean whitecaps ---
  float shore = 1.0 - smoothstep(0.0, 1.6, depth);
  float fn = vnoise(p * 0.18 + vec2(uTime * 0.3, 0.0)) * vnoise(p * 0.05 - uTime * 0.05);
  float bands = smoothstep(0.5, 0.9, sin(depth * 5.0 - uTime * 1.3 + fn * 4.0) * 0.5 + 0.5);
  float foam = shore * mix(0.3, 1.0, bands) * smoothstep(0.1, 0.5, fn + shore * 0.3);
  foam += ocean * smoothstep(0.82, 0.95, vnoise(p * 0.03 + uTime * 0.08) * vnoise(p * 0.11 - uTime * 0.1) * 2.2) * 0.35 * fade1;
  vec3 foamCol = vec3(0.9) * (sunIrr * 0.25 + skyIrr * 0.35);

  // --- city light shimmer (bright wide highlights of the lit districts on the water) ---
  vec3 surf = F * refl + spec;
  vec3 col = surf + (1.0 - F) * body * (1.0 - Tw);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.8);
  // the lagoon floor applies its own spectral absorption (terrain shader), so the
  // surface only needs to pass through what the Fresnel reflection leaves
  float transmit = (1.0 - F) * (1.0 - clamp(foam, 0.0, 1.0));
  float alpha = 1.0 - transmit;

  // --- aerial perspective ---
  float rhoR = heightAvgDensity(cameraPosition.y, vWorld.y, 8000.0);
  float rhoM = heightAvgDensity(cameraPosition.y, vWorld.y, 1100.0);
  vec3 od = dist * (vec3(5.802e-6, 13.558e-6, 33.1e-6) * rhoR + vec3(1.6e-5 * uHaze * rhoM));
  vec3 airT = exp(-od);
  vec3 ins = aerialInscatter(-V);
  col = col * airT + ins * (1.0 - airT) * alpha;

  // far away the surface is opaque so the (clipped) sea floor never shows through;
  // beyond the far plane the sky dome's analytic ocean takes over seamlessly
  float farOpaque = smoothstep(38000.0, 45000.0, length(vWorld.xz));
  col += (ins * (1.0 - airT) + body * airT) * (1.0 - alpha) * farOpaque;
  alpha = mix(alpha, 1.0, farOpaque);
  gl_FragColor = vec4(col, alpha);
}
`;

export class Water {
  constructor(infoTex, settings) {
    this.settings = settings;
    this.waveTex = createWaveNormalTexture();
    this.reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, U, {
        uWaveTex: { value: this.waveTex },
        uReflection: { value: this.reflRT.texture },
        uHasReflection: { value: settings.reflections ? 1 : 0 },
        uReflMatrix: { value: new THREE.Matrix4() },
        uInfo: { value: infoTex },
        uInfoHalf: { value: INNER.half },
      }),
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const geo = new THREE.PlaneGeometry(400000, 400000, 64, 64);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;

    this.virtualCam = new THREE.PerspectiveCamera();
    this.virtualCam.layers.set(0);
    this.virtualCam.layers.enable(2);
    this.virtualSkyCam = new THREE.PerspectiveCamera();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._rot = new THREE.Matrix4();
    this._look = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this.size = new THREE.Vector2(1, 1);
  }

  setSize(w, h) {
    this.size.set(w, h);
    const s = this.settings.reflectionScale;
    this.reflRT.setSize(Math.max(2, Math.floor(w * s)), Math.max(2, Math.floor(h * s)));
  }

  setSettings(settings) {
    this.settings = settings;
    this.material.uniforms.uHasReflection.value = settings.reflections ? 1 : 0;
    this.setSize(this.size.x, this.size.y);
  }

  /** Planar reflection via a mirrored camera with an oblique near plane (after three's Reflector). */
  renderReflection(renderer, camera, scene, skyScene, skyCam, hide, skyDomeMat) {
    if (!this.settings.reflections) return;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePos = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.05) return;
    const vc = this.virtualCam;
    this._rot.extractRotation(camera.matrixWorld);
    this._view.copy(planePos).sub(camPos).reflect(normal).negate().add(planePos);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    this._target.copy(planePos).sub(this._look).reflect(normal).negate().add(planePos);
    vc.position.copy(this._view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(normal);
    vc.lookAt(this._target);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const tm = this.material.uniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(vc.projectionMatrix);
    tm.multiply(vc.matrixWorldInverse);

    // sky camera for the mirrored view (non-oblique)
    const sc = this.virtualSkyCam;
    sc.position.copy(vc.position).multiplyScalar(0.001);
    sc.quaternion.copy(vc.quaternion);
    sc.fov = skyCam.fov; sc.aspect = skyCam.aspect; sc.near = skyCam.near; sc.far = skyCam.far;
    sc.updateProjectionMatrix();
    sc.updateMatrixWorld();

    // oblique clip plane so nothing below the water is reflected
    this._plane.setFromNormalAndCoplanarPoint(normal, planePos);
    this._plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = vc.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1.0 - 0.003;
    pm.elements[14] = clip.w;

    const prevAuto = renderer.autoClear;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    renderer.autoClear = false;
    renderer.setRenderTarget(this.reflRT);
    renderer.clear();
    if (skyDomeMat) skyDomeMat.uniforms.uEnvMode.value = 1;
    renderer.render(skyScene, sc);
    if (skyDomeMat) skyDomeMat.uniforms.uEnvMode.value = 0;
    renderer.clearDepth();
    renderer.render(scene, vc);
    renderer.autoClear = prevAuto;
    hide.forEach((o, i) => { o.visible = vis[i]; });
  }
}
