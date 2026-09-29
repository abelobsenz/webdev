import * as THREE from 'three';
import { catalogStars } from './skyCatalog.js';
import { planetSky, magWeight, SKY_PLANETS, cometSky, cometGain } from './ephemeris.js';

// The named stars as point sprites over the procedural sky: a diffraction-limited core whose
// drawn energy follows the magnitude (so a star never pops as it crosses a pixel), a faint
// optical halo, and for the handful of first-magnitude stars four thin spikes from the camera's
// secondary-mirror spider. Drawn at infinity from the camera's rotation only, additively, in
// the sky pass, so every solid body in front of them hides them.

const VERT = /* glsl */ `
attribute float aEnergy;
attribute vec3 aColor;
uniform float uPxScale;
uniform float uSkyStars;
varying vec3 vCol;
varying float vSize;
varying float vE;
void main() {
  vec3 v = mat3(viewMatrix) * position;
  gl_Position = projectionMatrix * vec4(v, 0.0);
  gl_Position.z = gl_Position.w * 0.99999;
  float E = aEnergy * uSkyStars;
  vE = E;
  vCol = aColor;
  // big enough to hold the halo and spikes of the bright ones
  // (held under the 64 px every WebGL2 implementation can draw)
  float s = min(clamp(7.0 + 9.0 * sqrt(max(E, 0.0)), 7.0, 72.0) * uPxScale, 64.0);
  vSize = s;
  gl_PointSize = s;
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vSize;
varying float vE;
uniform float uPxScale;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vSize;      // pixels from the star
  float r2 = dot(q, q);
  float sg = 0.72 * uPxScale;                  // the core's sigma (px)
  float core = exp(-r2 / (2.0 * sg * sg)) / (6.2832 * sg * sg);
  float hs = 2.6 * uPxScale;
  float halo = exp(-sqrt(r2) / hs) / (6.2832 * hs * hs);
  // spikes: only for the brightest, their length growing with the star's energy
  float spk = 0.0;
  float sE = smoothstep(4.0, 14.0, vE);
  if (sE > 0.0) {
    float L = vSize * 0.42;
    vec2 a = abs(q);
    float w = 0.55 * uPxScale;
    spk = (exp(-a.y * a.y / (w * w)) * exp(-a.x / (L * 0.35)) + exp(-a.x * a.x / (w * w)) * exp(-a.y / (L * 0.35))) / (L * 3.0) * sE;
  }
  // fade to nothing at the sprite's edge so no square outline shows
  float edge = 1.0 - smoothstep(0.36, 0.5, length(gl_PointCoord - 0.5));
  float I = vE * (0.9 * core + 0.1 * halo + 0.05 * spk) * edge;
  gl_FragColor = vec4(vCol * I, 0.0);
}
`;

/** Energy (in the sky shader's units: its brightest random star integrates to ~2.9) of a star of magnitude m. */
export function starEnergy(m) { return 2.9 * Math.pow(10, -0.4 * (m - 1.0)); }

export function createStarPoints() {
  const stars = catalogStars();
  const n = stars.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), en = new Float32Array(n);
  stars.forEach((s, i) => {
    pos.set([s.dir.x, s.dir.y, s.dir.z], i * 3);
    col.set([s.color.r, s.color.g, s.color.b], i * 3);
    en[i] = starEnergy(s.mag);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aEnergy', new THREE.BufferAttribute(en, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

export class StarPoints {
  constructor(skyUniforms) {
    this.uniforms = { uPxScale: { value: 1 }, uSkyStars: skyUniforms.uSkyStars };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    this.points = new THREE.Points(createStarPoints(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -999;
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (renderer) => {
      // sprites sized in device pixels: keep them the same on a high-density screen
      if (renderer && renderer.getDrawingBufferSize) {
        renderer.getDrawingBufferSize(size);
        this.uniforms.uPxScale.value = THREE.MathUtils.clamp(size.y / 1080, 0.6, 3.0);
      }
    };
  }
}

/**
 * The sky's moving parts: the planets carried along their orbits by the sim clock (directions
 * and brightness into SKY_UNIFORMS), refreshed a few times a second of sim time.
 */
export class SkyLife {
  constructor(space, skyUniforms) {
    this.u = skyUniforms;
    this.rows = [];
    this.comet = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.lastT = -Infinity;
    this.update(space ? space.sim : null);
  }

  update(sim) {
    const t = sim ? sim.t : 0;
    if (Math.abs(t - this.lastT) < 60) return;           // planets move a pixel in hours, the comet in minutes
    this.lastT = t;
    planetSky(t, this.rows);
    const P = this.u.uPlanets.value, C = this.u.uPlanetCol.value;
    for (let i = 0; i < SKY_PLANETS.length; i++) {
      const r = this.rows[i];
      P[i].set(r.dir.x, r.dir.y, r.dir.z, magWeight(r.mag));
      const c = SKY_PLANETS[i].col;
      C[i].set(c[0], c[1], c[2]);
    }
    // the comet runs on along its orbit (its tails turning to stay away from the Sun)
    if (sim && sim.sunPos) {
      cometSky(t, sim.sunPos, this.comet);
      this.u.uCometPos.value.copy(this.comet.pos);
      this.u.uCometVel.value.copy(this.comet.vel);
      this.u.uCometK.value.x = cometGain(this.comet.mag);
    }
  }
}
