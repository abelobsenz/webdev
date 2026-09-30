import * as THREE from 'three';

// Per-frame culling for the orbital scene. Most meshes out here switch three's own frustum culling
// off (camera-relative shading, shader-placed parts), so every station, town and fleet used to draw
// in every view: 10-25 million triangles a frame whether the thing was behind the camera or a speck
// a thousand kilometres away. Before the depth slices draw, this hides each mesh that
//   - lies wholly outside the view (a sphere test against the camera's side planes), or
//   - projects smaller than MIN_PX across (it could colour at most a pixel or two),
// and restores them after the frame. Meshes whose vertex shaders size themselves in pixels (lamps,
// markers, the Earth's pixel-scaled layers) are left alone, as is anything flagged
// userData.noCull. Bounds are the geometry's (an instanced mesh's: over its instances, refreshed as
// they move), padded for vertex-shader displacement.

const MIN_PX = 1.25;                   // projected diameter below which a mesh is skipped
const PAD = 1.2;                       // bound radius margin (shader displacement, a frame's motion)
const PIXEL_SIZED = /\b(uPixAng|uRes|uPx|uPxScale|uResolution|uResY|uMinPx|uPixel|gl_PointSize)\b/;
const REFRESH = 30;                    // frames between rebuilds of the mesh list

const _s = new THREE.Sphere(), _m = new THREE.Matrix4(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _cam = new THREE.PerspectiveCamera(), _fw = new THREE.Vector3(), _dv = new THREE.Vector3();

function pixelSized(mat) {
  if (!mat) return false;
  if (Array.isArray(mat)) return mat.some(pixelSized);
  if (mat.__pixelSized !== undefined) return mat.__pixelSized;
  const src = (mat.vertexShader || '') + (mat.userData && mat.userData.pixelSized ? ' uPx ' : '');
  mat.__pixelSized = PIXEL_SIZED.test(src);
  return mat.__pixelSized;
}

export class SpaceCuller {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.hidden = [];
    this.frame = 0;
    this.enabled = true;
    this.stats = { meshes: 0, hiddenOut: 0, hiddenSmall: 0, sliceSkips: 0 };
    // the meshes left visible this frame and their depth spans along the view axis, so each depth
    // slice draws only what overlaps its [near, far] (a mesh outside every body's slice set used to
    // draw once per slice)
    this.cand = []; this.zlo = new Float64Array(0); this.zhi = new Float64Array(0);
    this.sliceHidden = [];
  }

  _rebuild() {
    const list = this.list; list.length = 0;
    this.scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isBatchedMesh || o.userData.noCull) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      if (pixelSized(o.material)) return;
      list.push(o);
    });
    this.stats.meshes = list.length;
  }

  /** The mesh's bounding sphere in its own frame (instanced: over its instances), or null. */
  _local(o) {
    if (o.isInstancedMesh) {
      const v = o.instanceMatrix.version, c = o.count;
      const u = o.userData;
      if (!o.boundingSphere || ((u.__cullV !== v || u.__cullC !== c) && this.frame - (u.__cullF || 0) >= 15)) {
        if (c === 0) return null;
        o.computeBoundingSphere();
        u.__cullV = v; u.__cullC = c; u.__cullF = this.frame;
        // instances that move between refreshes: a wider margin
        u.__cullPad = u.__cullSeen !== undefined && u.__cullSeen !== v ? 1.6 : 1.0;
        u.__cullSeen = v;
      }
      return o.boundingSphere;
    }
    const g = o.geometry;
    if (!g.boundingSphere) {
      // released geometry keeps its bounds (releaseCpu computes them first); otherwise compute now
      if (!g.attributes.position.array) return null;
      g.computeBoundingSphere();
    }
    return g.boundingSphere;
  }

  /** Hide what cannot be seen from cam (a viewport heightPx tall). Call restore() after drawing. */
  apply(cam, heightPx) {
    this.hidden.length = 0;
    this.stats.hiddenOut = this.stats.hiddenSmall = this.stats.sliceSkips = 0;
    if (!this.enabled) return;
    if (this.frame++ % REFRESH === 0) this._rebuild();
    // side planes only: the depth slices set near/far per pass, so test against a deep frustum
    _cam.copy(cam, false); _cam.near = 1e-6; _cam.far = 1e13; _cam.updateProjectionMatrix();
    _pm.multiplyMatrices(_cam.projectionMatrix, cam.matrixWorldInverse);
    _f.setFromProjectionMatrix(_pm);
    const k = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / (cam.zoom || 1);
    const cp = cam.position, fwd = _fw.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (this.zlo.length < this.list.length) { this.zlo = new Float64Array(this.list.length * 2); this.zhi = new Float64Array(this.list.length * 2); }
    const cand = this.cand; cand.length = 0;
    for (const o of this.list) {
      if (!o.visible) continue;
      const loc = this._local(o);
      if (!loc || loc.radius <= 0 || !Number.isFinite(loc.radius)) continue;
      _s.copy(loc).applyMatrix4(o.matrixWorld);
      _s.radius *= PAD * (o.userData.__cullPad || 1);
      const d = _s.center.distanceTo(cp);
      if (d <= _s.radius) continue;                              // the camera is inside it
      if ((2 * _s.radius / d) * k < MIN_PX) { o.visible = false; this.hidden.push(o); this.stats.hiddenSmall++; continue; }
      if (!_f.intersectsSphere(_s)) { o.visible = false; this.hidden.push(o); this.stats.hiddenOut++; continue; }
      const dz = _dv.copy(_s.center).sub(cp).dot(fwd), n = cand.length;
      this.zlo[n] = dz - _s.radius; this.zhi[n] = dz + _s.radius; cand.push(o);
    }
  }

  /** Before a depth slice draws: hide the visible meshes wholly nearer than near or beyond far. */
  sliceBegin(near, far) {
    const h = this.sliceHidden; h.length = 0;
    if (!this.enabled) return;
    const cand = this.cand, lo = this.zlo, hi = this.zhi;
    for (let i = 0; i < cand.length; i++) {
      const o = cand[i];
      if (o.visible && (hi[i] < near || lo[i] > far)) { o.visible = false; h.push(o); }
    }
    this.stats.sliceSkips += h.length;
  }

  sliceEnd() {
    for (const o of this.sliceHidden) o.visible = true;
    this.sliceHidden.length = 0;
  }

  restore() {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
}
