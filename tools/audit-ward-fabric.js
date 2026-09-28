// In-browser fabric audit for the Outer Wards: every tree, lamp and bench of the listed
// wards against the actual built triangles (platform walls and balustrades, stairs,
// landmarks and monuments, towns, bridges, transit). Reports trunk and lower-crown clashes,
// unsupported roots and lamps, and benches under solids.
// Run on a build with the capture tool and read the AUDITn lines from its output:
//   node review/baseline/_tools/cap.mjs --dist <dist>/index.html --out <dir> --views <one view> \
//        --quality medium --eval "$(cat tools/audit-ward-fabric.js)"
// (define window.__AUDIT_IDS first to audit other wards). Tree roots higher than 80 m are the
// arcologies' sky gardens: their floors are skipped, so treat those rows as not measured.
(() => {
  const A = window.meridian, w = A.world, T = A.THREE;
  const ids = (window.__AUDIT_IDS || ['aurora', 'tidewater', 'sunward', 'seraph']);
  const wards = w.metro.wards.filter((q) => ids.includes(q.def.id));
  const t0 = performance.now();
  const trees = w.placeTrees();
  const report = {};
  for (const W of wards) {
    const wx = W.def.x, wz = W.def.z, half = W.half;
    const inWard = (x, z) => Math.abs(x - wx) < half && Math.abs(z - wz) < half;
    // ---- candidate solids: every non-instanced mesh of the ward's built fabric
    const cands = [];
    w.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
      const n = o.name || '';
      if (/far$| far|glows|reef apron|Water|water|sky|cloud|terrain|Terrain|beaches|ground$|Great Ring|lane-beacons/i.test(n)) return;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      o.updateMatrixWorld(true);
      const s = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      if (Math.abs(s.center.x - wx) > half + s.radius || Math.abs(s.center.z - wz) > half + s.radius) return;
      cands.push(o);
    });
    // ---- triangle grid (6 m cells) over the ward
    const C = 6, GN = Math.ceil((2 * half) / C) + 2, cells = new Array(GN * GN);
    const cellKey = (i, j) => { const a = i - Math.floor((wx - half) / C) + 1, b = j - Math.floor((wz - half) / C) + 1; return a < 0 || b < 0 || a >= GN || b >= GN ? -1 : b * GN + a; };
    const tri = [];                          // flat: ax ay az bx by bz cx cy cz, meshId
    const names = [];
    const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3();
    for (const o of cands) {
      const id = names.length; names.push(o.name || '(noname)');
      const p = o.geometry.attributes.position, ix = o.geometry.index, m = o.matrixWorld, ident = m.equals(new T.Matrix4());
      const nT = ix ? ix.count / 3 : p.count / 3;
      for (let t = 0; t < nT; t++) {
        const i0 = ix ? ix.getX(t * 3) : t * 3, i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1, i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2;
        va.fromBufferAttribute(p, i0); vb.fromBufferAttribute(p, i1); vc.fromBufferAttribute(p, i2);
        if (!ident) { va.applyMatrix4(m); vb.applyMatrix4(m); vc.applyMatrix4(m); }
        const x0 = Math.min(va.x, vb.x, vc.x), x1 = Math.max(va.x, vb.x, vc.x), z0 = Math.min(va.z, vb.z, vc.z), z1 = Math.max(va.z, vb.z, vc.z);
        if (x1 < wx - half || x0 > wx + half || z1 < wz - half || z0 > wz + half) continue;
        if (Math.min(va.y, vb.y, vc.y) > 80) continue;              // far above anything probed
        if (x1 - x0 > 90 || z1 - z0 > 90) continue;                  // vast flat skins
        // skip near-vertical faces: a down-probe cannot meet them (their caps can)
        const ex = vb.x - va.x, ez = vb.z - va.z, fx = vc.x - va.x, fz = vc.z - va.z, det = ex * fz - ez * fx;
        if (Math.abs(det) < 1e-6) continue;
        const k = tri.length / 10;
        tri.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z, id);
        for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
          const key = cellKey(i, j); if (key < 0) continue;
          let l = cells[key]; if (!l) cells[key] = (l = []); l.push(k);
        }
      }
    }
    // heights of every surface over (x, z) between lo and hi, with the mesh names
    const hitsAt = (x, z, lo, hi) => {
      const key = cellKey(Math.floor(x / C), Math.floor(z / C)); const l = key < 0 ? null : cells[key]; if (!l) return [];
      const out = [];
      for (const k of l) {
        const b = k * 10;
        const ax = tri[b], ay = tri[b + 1], az = tri[b + 2];
        const ex = tri[b + 3] - ax, ey = tri[b + 4] - ay, ez = tri[b + 5] - az, fx = tri[b + 6] - ax, fy = tri[b + 7] - ay, fz = tri[b + 8] - az;
        const det = ex * fz - ez * fx, px = x - ax, pz = z - az;
        const u = (px * fz - pz * fx) / det, v = (ex * pz - ez * px) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const y = ay + u * ey + v * fy;
        if (y >= lo && y <= hi) out.push([y, tri[b + 9]]);
      }
      return out;
    };
    const R = { trees: 0, trunkHits: [], floating: [], canopy: [], lamps: 0, lampHits: [], lampFloat: [], benches: 0, benchHits: [] };
    const disc = (x, z, r, n) => { const o = [[x, z]]; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; o.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return o; };
    for (const t of trees) {
      if (!inWard(t.x, t.z)) continue;
      R.trees++;
      const trunkR = Math.max(0.6, t.s * 0.035);
      // trunk column: nothing between 0.5 m and 4 m above the root, over the trunk's disc
      let hit = null;
      for (const [x, z] of disc(t.x, t.z, trunkR, 8)) { const h = hitsAt(x, z, t.y + 0.5, t.y + Math.min(4, t.s * 0.5)); if (h.length) { hit = h[0]; break; } }
      if (hit) R.trunkHits.push([+t.x.toFixed(1), +t.z.toFixed(1), +t.y.toFixed(2), names[hit[1]], +(hit[0] - t.y).toFixed(2)]);
      // support: the ground (or a built surface) under the trunk's whole disc
      const support = (x, z) => { const g = hitsAt(x, z, t.y - 3, t.y + 0.45); return Math.max(w.groundHeight(x, z), g.length ? Math.max(...g.map((q) => q[0])) : -Infinity); };
      const sc = support(t.x, t.z), se = Math.min(...disc(t.x, t.z, trunkR, 8).map(([x, z]) => support(x, z)));
      if (!(sc > t.y - 0.3) || !(se > t.y - 0.6)) R.floating.push([+t.x.toFixed(1), +t.z.toFixed(1), +t.y.toFixed(2), +sc.toFixed(2), +se.toFixed(2)]);
      // canopy: the lower crown (0.45..0.9 of the height) over 55% of its radius
      const cr = 0.55 * 0.5 * [0.62, 0.58, 1.55, 1.35, 0.6, 1.0, 0.5, 1.05, 1.6, 0.38, 1.0][t.sp] * t.s || 2;
      let ch = null;
      for (const [x, z] of disc(t.x, t.z, Math.max(1, cr), 10)) { const h = hitsAt(x, z, t.y + t.s * 0.45, t.y + t.s * 0.9); if (h.length) { ch = h[0]; break; } }
      if (ch) R.canopy.push([+t.x.toFixed(1), +t.z.toFixed(1), names[ch[1]], +(ch[0] - t.y).toFixed(1), t.sp, +t.s.toFixed(1)]);
    }
    for (const S of w.metro.streetscapes || []) for (const l of S.lamps || []) {
      if (!inWard(l.x, l.z) || l.y === undefined) continue;
      R.lamps++;
      const h = hitsAt(l.x, l.z, l.y + 0.4, l.y + 6);
      if (h.length) R.lampHits.push([+l.x.toFixed(1), +l.z.toFixed(1), +l.y.toFixed(2), names[h[0][1]], +(h[0][0] - l.y).toFixed(2)]);
      const g = hitsAt(l.x, l.z, l.y - 3, l.y + 0.35);
      const top = Math.max(w.groundHeight(l.x, l.z), g.length ? Math.max(...g.map((q) => q[0])) : -Infinity);
      if (!(top > l.y - 0.35)) R.lampFloat.push([+l.x.toFixed(1), +l.z.toFixed(1), +l.y.toFixed(2), +top.toFixed(2)]);
    }
    for (const S of w.metro.streetscapes || []) for (const b of S.benches || []) {
      if (!inWard(b.x, b.z)) continue;
      R.benches++;
      const gy = w.groundHeight(b.x, b.z);
      for (const [x, z] of disc(b.x, b.z, 0.9, 6)) { const h = hitsAt(x, z, gy + 0.3, gy + 2.5); if (h.length) { R.benchHits.push([+b.x.toFixed(1), +b.z.toFixed(1), names[h[0][1]]]); break; } }
    }
    const summarize = (l) => ({ n: l.length, first: l.slice(0, 12) });
    report[W.def.id] = { trees: R.trees, lamps: R.lamps, benches: R.benches, tris: tri.length / 10, trunkHits: summarize(R.trunkHits), floating: summarize(R.floating), canopy: summarize(R.canopy), lampHits: summarize(R.lampHits), lampFloat: summarize(R.lampFloat), benchHits: summarize(R.benchHits) };
  }
  report.ms = Math.round(performance.now() - t0);
  const s = JSON.stringify(report);
  for (let i = 0; i < s.length; i += 3500) console.warn('AUDIT' + (i / 3500) + ' ' + s.slice(i, i + 3500));
})();
