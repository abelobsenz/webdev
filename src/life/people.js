import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchedMaterial } from '../world/materials.js';
import { mulberry32 } from '../world/noise.js';
import { PLAZA_Y } from '../world/layout.js';

// Citizens strolling the Axis plaza: GPU-animated along concentric walks.
function personGeometry() {
  const body = new THREE.CapsuleGeometry(0.2, 0.9, 2, 6).translate(0, 0.65, 0);
  const head = new THREE.SphereGeometry(0.13, 6, 4).translate(0, 1.55, 0);
  for (const g of [body, head]) g.deleteAttribute('uv');
  return mergeGeometries([body.toNonIndexed(), head.toNonIndexed()], false);
}

export class People {
  constructor(scene, settings) {
    const rnd = mulberry32(606);
    const lanes = [[80, 205], [262, 298], [338, 372], [424, 456], [486, 548]];
    const n = 3200;
    const data = new Float32Array(n * 4); // radius, angle0, angular speed, hue
    for (let i = 0; i < n; i++) {
      const lane = lanes[Math.floor(rnd() * lanes.length)];
      const r = lane[0] + rnd() * (lane[1] - lane[0]);
      const speed = (0.9 + rnd() * 0.8) * (rnd() < 0.5 ? 1 : -1);
      data.set([r, rnd() * Math.PI * 2, speed / r, rnd()], i * 4);
    }
    const base = personGeometry();
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', base.attributes.position);
    ig.setAttribute('normal', base.attributes.normal);
    ig.setAttribute('aWalk', new THREE.InstancedBufferAttribute(data, 4));
    ig.instanceCount = n;
    this.full = n;
    const mat = patchedMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0 }, {
      key: 'people',
      uniforms: { uPlazaY: { value: PLAZA_Y } },
      vertex: {
        pars: 'attribute vec4 aWalk; uniform float uPlazaY; varying float vHue; mat3 pRot; vec3 pPos;',
        preNormal: /* glsl */ `
{
  float a = aWalk.y + uTime * aWalk.z;
  pPos = vec3(cos(a) * aWalk.x, uPlazaY, sin(a) * aWalk.x);
  vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(aWalk.z));
  vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  pRot = mat3(side, vec3(0.0, 1.0, 0.0), fwd);
  objectNormal = pRot * objectNormal;
  vHue = aWalk.w;
}`,
        transform: 'transformed = pRot * transformed + pPos + vec3(0.0, abs(sin(uTime * 7.0 + aWalk.w * 40.0)) * 0.05, 0.0);',
      },
      fragment: {
        pars: 'varying float vHue;',
        color: /* glsl */ `
{
  vec3 pal[6] = vec3[6](vec3(0.92, 0.9, 0.86), vec3(0.2, 0.3, 0.5), vec3(0.75, 0.35, 0.25), vec3(0.3, 0.5, 0.35), vec3(0.85, 0.7, 0.35), vec3(0.15, 0.15, 0.17));
  diffuseColor.rgb = pal[int(vHue * 5.99)];
}`,
        emissive: 'totalEmissiveRadiance += vec3(0.6, 0.85, 1.0) * uCityLights * 0.03 * step(0.85, fract(vHue * 13.0));',
      },
    });
    this.mesh = new THREE.Mesh(ig, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.geo = ig;
    scene.add(this.mesh);
    this.applyQuality(settings);
  }
  applyQuality(s) { this.enabled = s.people; this.mesh.visible = s.people; }
  update(dt, t, camera) {
    // only worth drawing when the viewer is near the plaza
    if (camera) this.mesh.visible = this.enabled && Math.hypot(camera.position.x, camera.position.z) < 2500 && camera.position.y < 900;
  }
}
