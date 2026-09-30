import * as THREE from 'three';

// Per-frame culling for the orbital scene. Most meshes out here switch three's own frustum culling
// off (camera-relative shading, shader-placed parts), so every station, town and fleet used to draw
// in every view: 10-25 million triangles a frame whether the thing was behind the camera or a speck
// a thousand kilometres away. Before the depth slices draw, this hides each mesh that
//   - lies wholly outside the view (a sphere test against the camera's side planes), or
//   - projects smaller than MIN_PX across (it could colour at most a pixel or two),
// and restores them after the frame. Meshes whose vertex shaders size themselves in pixels (lamps,
// markers, the Earth's pixel-scaled layers) or place themselves without the model matrix are left
// alone, as is anything flagged
// userData.noCull. Bounds are the geometry's (an instanced mesh's: over its instances, refreshed as
// they move), padded for vertex-shader displacement.

const MIN_PX = 1.25;                   // projected diameter below which a mesh is skipped
const PAD = 1.2;                       // bound radius margin (shader displacement, a frame's motion)
const PIXEL_SIZED = /\b(uPixAng|uRes|uPx|uPxScale|uResolution|uResY|uMinPx|uPixel|gl_PointSize)\b/;
const REFRESH = 8;                     // frames between rebuilds of the mesh list (lazily built parts join quickly)

const _s = new THREE.Sphere(), _m = new THREE.Matrix4(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _cam = new THREE.PerspectiveCamera(), _fw = new THREE.Vector3(), _dv = new THREE.Vector3();

// ---- far stand-ins for instanced sets: once a set's single part would draw under a few pixels
// even at the set's nearest point, its prototype is swapped for a vertex-clustered copy of a few
// dozen triangles (made on first use, kept per geometry), and back again as the camera closes in
const PROXY_MIN_TRIS = 30000;          // a set this heavy (instances x prototype) is worth a stand-in
const PROXY_PX = 2.5, PROXY_PX_BACK = 3.5;
const _proxies = new WeakMap();
const _e = new THREE.Vector3(), _ms = new THREE.Vector3(), _mq = new THREE.Quaternion(), _mp = new THREE.Vector3(), _im = new THREE.Matrix4();

function trisOf(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

function proxyable(g) {
  if (!g || g.groups.length > 1 || Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  for (const k in g.attributes) { const at = g.attributes[k]; if (at.isInterleavedBufferAttribute || (!at.isInstancedBufferAttribute && !at.array)) return false; }
  if (g.index && !g.index.array) return false;
  return true;
}

/** Vertex clustering: snap the vertices to a coarse grid over the bounds, one survivor per cell. */
function clusterProxy(g) {
  if (_proxies.has(g)) return _proxies.get(g);
  let out = null;
  if (proxyable(g)) {
    const pos = g.attributes.position, n = pos.count;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox, ext = bb.getSize(_e), big = Math.max(ext.x, ext.y, ext.z, 1e-9);
    const G = 4, cx = Math.max(1, Math.round((G * ext.x) / big)), cy = Math.max(1, Math.round((G * ext.y) / big)), cz = Math.max(1, Math.round((G * ext.z) / big));
    const cellOf = new Int32Array(n), rep = new Map(), keep = [];
    for (let i = 0; i < n; i++) {
      const x = Math.min(cx - 1, Math.floor(((pos.getX(i) - bb.min.x) / Math.max(ext.x, 1e-9)) * cx));
      const y = Math.min(cy - 1, Math.floor(((pos.getY(i) - bb.min.y) / Math.max(ext.y, 1e-9)) * cy));
      const z = Math.min(cz - 1, Math.floor(((pos.getZ(i) - bb.min.z) / Math.max(ext.z, 1e-9)) * cz));
      // cells also split by the vertex's facing, so a thin slab keeps both its faces
      const nx = g.attributes.normal ? (g.attributes.normal.getX(i) > 0.5 ? 1 : g.attributes.normal.getX(i) < -0.5 ? 2 : 0) + 3 * (g.attributes.normal.getY(i) > 0.5 ? 1 : g.attributes.normal.getY(i) < -0.5 ? 2 : 0) + 9 * (g.attributes.normal.getZ(i) > 0.5 ? 1 : g.attributes.normal.getZ(i) < -0.5 ? 2 : 0) : 0;
      const key = ((x * cy + y) * cz + z) * 27 + nx;
      let r = rep.get(key);
      if (r === undefined) { r = keep.length; rep.set(key, r); keep.push(i); }
      cellOf[i] = r;
    }
    const tri = [], seen = new Set();
    const T = trisOf(g), I = g.index;
    for (let t = 0; t < T; t++) {
      const a = cellOf[I ? I.getX(t * 3) : t * 3], b = cellOf[I ? I.getX(t * 3 + 1) : t * 3 + 1], c = cellOf[I ? I.getX(t * 3 + 2) : t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      // one copy of each surviving triangle (rotations of the same winding)
      const m = Math.min(a, b, c), k = m === a ? `${a},${b},${c}` : m === b ? `${b},${c},${a}` : `${c},${a},${b}`;
      if (seen.has(k)) continue; seen.add(k); tri.push(a, b, c);
    }
    if (tri.length >= 3 && tri.length / 3 < T * 0.6) {
      out = new THREE.BufferGeometry();
      for (const k in g.attributes) {
        const at = g.attributes[k];
        if (at.isInstancedBufferAttribute) { out.setAttribute(k, at); continue; }   // per-instance data: shared
        const src = at.array, w = at.itemSize, arr = new src.constructor(keep.length * w);
        for (let j = 0; j < keep.length; j++) for (let q = 0; q < w; q++) arr[j * w + q] = src[keep[j] * w + q];
        out.setAttribute(k, new THREE.BufferAttribute(arr, w, at.normalized));
      }
      out.setIndex(tri);
      out.boundingSphere = (g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere)).clone();
      out.boundingBox = bb.clone();
      out.userData.cullProxy = true;
    }
  }
  _proxies.set(g, out);
  return out;
}

/** The largest scale any of the set's instances applies (sampled), times the mesh's own. */
function instanceScale(o) {
  const c = o.count, step = Math.max(1, Math.floor(c / 48));
  let m = 0;
  for (let i = 0; i < c; i += step) { o.getMatrixAt(i, _im); _im.decompose(_mp, _mq, _ms); m = Math.max(m, _ms.x, _ms.y, _ms.z); }
  return m;
}

function pixelSized(mat) {
  if (!mat) return false;
  if (Array.isArray(mat)) return mat.some(pixelSized);
  if (mat.__pixelSized !== undefined) return mat.__pixelSized;
  const src = (mat.vertexShader || '') + (mat.userData && mat.userData.pixelSized ? ' uPx ' : '');
  // (and shaders that place their vertices without the model matrix - the terrain patch's polar
  // grid, shells drawn from uniforms: their geometry's bounds say nothing about where they draw)
  mat.__pixelSized = PIXEL_SIZED.test(src) || (!!mat.vertexShader && !/\bmodel(View)?Matrix\b/.test(mat.vertexShader));
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
      if (o.isInstancedMesh) this._proxy(o, d, _s.radius / (PAD * (o.userData.__cullPad || 1)), k);
      const dz = _dv.copy(_s.center).sub(cp).dot(fwd), n = cand.length;
      this.zlo[n] = dz - _s.radius; this.zhi[n] = dz + _s.radius; cand.push(o);
    }
  }

  /** Swap an instanced set's prototype for its far stand-in (or back) by the size of one part. */
  _proxy(o, d, R, k) {
    const u = o.userData;
    if (u.noProxy) return;
    const full = u.__fullGeo || o.geometry;
    if (u.__proxyTris === undefined) u.__proxyTris = trisOf(full);
    if (u.__proxyTris * o.count < PROXY_MIN_TRIS && !u.__proxyOn) return;
    if (u.__protoR === undefined || this.frame - (u.__protoF || 0) > 120) {
      if (!full.boundingSphere) full.computeBoundingSphere();
      u.__protoR = full.boundingSphere.radius * instanceScale(o) * o.matrixWorld.getMaxScaleOnAxis();
      u.__protoF = this.frame;
    }
    const near = Math.max(d - R, u.__protoR, 1e-9);
    const px = ((2 * u.__protoR) / near) * k;
    const want = u.__proxyOn ? px < PROXY_PX_BACK : px < PROXY_PX;
    if (want === !!u.__proxyOn) return;
    if (want) {
      const pg = clusterProxy(full);
      if (!pg) { u.noProxy = true; return; }
      u.__fullGeo = full; o.geometry = pg; u.__proxyOn = true;
      this.stats.proxies = (this.stats.proxies || 0) + 1;
    } else { o.geometry = full; u.__proxyOn = false; }
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
