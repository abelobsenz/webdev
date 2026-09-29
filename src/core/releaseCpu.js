import * as THREE from 'three';

// three.js keeps every BufferAttribute's array in JS memory after uploading it to the GPU. The
// city's large static meshes (buildings, terraces, countryside, town skins) are never read on the
// CPU again, and those copies came to about 4 GB - most of the page's heap, near Chrome's per-tab
// ceiling. Each such attribute drops its array once the GPU has it.
//
// Only plain meshes with every attribute static qualify: instanced, skinned, morphing and
// interleaved geometry, anything with a dynamic attribute, and geometry flagged
// userData.keepCPU (read later for raycasts, merges or clones) keep their arrays. Geometry flagged
// userData.cpuHold is read once more after load (the collision grid rasterises the solids in
// slices); it is released by releaseHeld() when that reader is done. Bounding volumes are
// computed first so three.js never needs the positions again. (three keeps .count and the
// buffer's type after upload; a static attribute is never re-uploaded.)

function onUploaded() { this.__uploaded = true; if (!this.__hold) this.array = null; }

/** Mark the large static geometry under root to free its CPU arrays after upload. */
export function releaseStaticGeometry(root, { minVertices = 4000 } = {}) {
  let geometries = 0, bytes = 0, held = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const g = o.geometry;
    if (!g || g.isInstancedBufferGeometry || g.userData.keepCPU || g.userData.cpuReleased) return;
    const pos = g.attributes.position;
    if (!pos || pos.count < minVertices || !pos.array) return;
    if (Object.keys(g.morphAttributes).length) return;
    const attrs = Object.values(g.attributes);
    if (g.index) attrs.push(g.index);
    if (attrs.some((a) => !a.array || a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute || a.usage !== THREE.StaticDrawUsage)) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    const hold = !!g.userData.cpuHold;
    for (const a of attrs) { bytes += a.array.byteLength; a.__hold = hold; a.onUpload(onUploaded); }
    g.userData.cpuReleased = true;
    geometries++; if (hold) held++;
  });
  return { geometries, held, bytes };
}

/** Release the held geometry of these meshes (their last CPU reader has finished). */
export function releaseHeld(meshes) {
  let bytes = 0;
  for (const o of meshes) {
    const g = o && o.geometry;
    if (!g || !g.userData.cpuHold) continue;
    g.userData.cpuHold = false;
    const attrs = Object.values(g.attributes);
    if (g.index) attrs.push(g.index);
    for (const a of attrs) {
      if (!a.__hold) continue;
      a.__hold = false;
      if (a.__uploaded && a.array) { bytes += a.array.byteLength; a.array = null; }
    }
  }
  return bytes;
}

/**
 * Upload every mesh under root once, into a 1x1 target, so the marked geometry is on the GPU (and
 * released) at load instead of whenever its LOD first shows it. Visibility, culling and layers
 * are restored afterwards.
 */
export function uploadAll(renderer, scene, camera) {
  const saved = [];
  scene.traverse((o) => {
    saved.push([o, o.visible, o.frustumCulled]);
    o.visible = true; o.frustumCulled = false;
  });
  const rt = new THREE.WebGLRenderTarget(1, 1);
  const layers = camera.layers.mask;
  const prevRT = renderer.getRenderTarget();
  try {
    camera.layers.enableAll();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  } finally {
    camera.layers.mask = layers;
    renderer.setRenderTarget(prevRT);
    rt.dispose();
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
  }
}
