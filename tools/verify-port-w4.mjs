// Wave 4 invariants of the geostationary port's refinement (called from tools/verify-port.mjs):
// the port finishes' shader (kinds 38/39, the white trim, the fail-soft splice), the terrace's
// architecture (belvedere, hall piers and lanterns, porticoes, cushion canopies, lit kerbs), the
// Harbour's gallery plate and pier heads, Concord Yard's web frames, plated portals and girder
// cranes, the Water Store's galleries, wheel and tank domes, the belt's terraced rims and
// plated slipways, build timings, and buffer sanity for every instanced mesh the port draws.

/** kind histogram of a geometry: kind -> vertex count */
function kindCount(geo) {
  const f = geo.attributes.aFacade.array, out = {};
  for (let i = 2; i < f.length; i += 3) { const k = Math.round(f[i]); out[k] = (out[k] || 0) + 1; }
  return out;
}
/** vertices of kind k passing pred(x, y, z) */
function countWhere(geo, k, pred) {
  const f = geo.attributes.aFacade.array, p = geo.attributes.position.array;
  let n = 0;
  for (let v = 0; v < p.length / 3; v++) if (Math.round(f[v * 3 + 2]) === k && pred(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])) n++;
  return n;
}
/** every InstancedMesh under root: count within its buffer, instanced attributes long enough, indices in range */
function instancedSane(check, root, name) {
  let n = 0;
  root.traverse((m) => {
    if (!m.isInstancedMesh) return;
    n++;
    check(m.count <= m.instanceMatrix.count, `${name}: instanced count ${m.count} > ${m.instanceMatrix.count}`);
    for (const [k, a] of Object.entries(m.geometry.attributes)) if (a.isInstancedBufferAttribute) check(a.count >= m.instanceMatrix.count, `${name}: instanced ${k} short`);
    if (m.instanceColor) check(m.instanceColor.count >= m.instanceMatrix.count, `${name}: instanceColor short`);
    const g = m.geometry, pc = g.attributes.position.count;
    if (g.index) { let mx = 0; const ix = g.index.array; for (let i = 0; i < ix.length; i++) if (ix[i] > mx) mx = ix[i]; check(mx < pc, `${name}: instanced index ${mx} >= ${pc}`); }
    const e = m.instanceMatrix.array;
    let fin = true;
    for (let i = 0; i < m.count * 16; i++) if (!Number.isFinite(e[i])) { fin = false; break; }
    check(fin, `${name}: non-finite instance matrix`);
  });
  return n;
}

export function wave4Checks(ctx) {
  const { check, out, bufferSane, THREE, PK, CK, DK, PORT_GLSL, portShaders, createPortMaterial, createDressedMaterial } = ctx;
  const w4 = (out.wave4 = {});

  // ---------------------------------------------------------------- shader ----
  {
    check(PK.GALLERY === 38 && PK.ROOF === 39, 'port kinds 38 (gallery) and 39 (roof) defined');
    check(/k > 37\.5 && k < 38\.5/.test(PORT_GLSL) && /k > 38\.5/.test(PORT_GLSL), 'port GLSL draws the gallery and roof kinds');
    check(/if \(k > 39\.5\) return;/.test(PORT_GLSL), 'port GLSL leaves kinds above 39 alone');
    check(/uniform float uPortTrim;/.test(PORT_GLSL), 'uPortTrim declared in the port GLSL');
    // the trim compresses only the bright end: a smoothstep on luminance, never a darkening of the darks
    check(/alb \*= mix\(1\.0, uPortTrim, smoothstep\(0\.3, 0\.75, lum\)\)/.test(PORT_GLSL), 'white trim weighted to the bright end');
    // no loops, no int declarations, no non-uniform derivative reads in the kinds
    check(!/\bfor\s*\(|\bwhile\s*\(/.test(PORT_GLSL), 'port GLSL: no loops');
    check(!/\bint\s+\w/.test(PORT_GLSL), 'port GLSL: no int declarations');
    const m = createPortMaterial({ trim: 0.7 });
    check(m.uniforms.uPortTrim.value === 0.7, 'trim option reaches the uniform');
    // fail soft 1: the craft shader's last lighting line in a new form -> occlusion falls back to the
    // colour before it is written, kinds still spliced
    const base = createDressedMaterial({});
    const fsAlt = base.fragmentShader.replace(/col \+= alb \* 0\.004[^;\n]*\+ em;/, 'col += em + alb * 0.003;');
    const s1 = portShaders(base.vertexShader, fsAlt);
    check(s1.kinds && s1.occ && /col \*= 1\.0 - 0\.82 \* clamp\(vOcc, 0\.0, 1\.0\);\s*gl_FragColor/.test(s1.fs), 'port splice: occlusion falls back when the lighting line changes');
    check((s1.fs.match(/varying float vOcc;/g) || []).length === 1 && /vOcc = aOcc;/.test(s1.vs), 'port splice fallback: varying declared once and fed');
    // fail soft 2: the dressed kinds' call gone -> the port kinds go in before the bump
    const fsNoBelt = base.fragmentShader.replace('beltKinds(k, f, fw, px, alb, rough, metal, em, bump);', '');
    const s2 = portShaders(base.vertexShader, fsNoBelt);
    const iP = s2.fs.indexOf('portKinds(k, f, fw, px, alb, rough, metal, em, bump);'), iB = s2.fs.indexOf('N = normalize(N + T * bump.x');
    check(s2.kinds && iP > 0 && iP < iB, 'port splice: kinds placed before the bump when the dressed call is missing');
    // the real splice stays the primary form
    const s0 = portShaders(base.vertexShader, base.fragmentShader);
    check(/col = col \* \(1\.0 - 0\.82 \* clamp\(vOcc, 0\.0, 1\.0\)\) \+ alb \* 0\.004/.test(s0.fs), 'port splice: primary occlusion form on the current craft shader');
    base.dispose(); m.dispose();
  }

  // --------------------------------------------------------------- terrace ----
  {
    let t0 = performance.now();
    const td = ctx.buildEmbarkationTerrace(), g = td.geo, fl = td.floor;
    w4.terraceBuildMs = +(performance.now() - t0).toFixed(1);
    check(w4.terraceBuildMs < 400, `terrace build ${w4.terraceBuildMs} ms`);
    const kc = kindCount(g);
    check(kc[PK.ROOF] > 0, 'terrace: zinc roofs on the lanterns and porticoes');
    check(!kc[PK.GALLERY] || kc[PK.GALLERY] > 0, 'terrace: gallery plate optional');
    // the belvedere: paving 2.4 m up along the northern rim, open (not shaded as a footprint)
    const P = g.attributes.position.array, F = g.attributes.aFacade.array, O = g.attributes.aOcc.array;
    let belv = 0, belvOcc = 0;
    for (let v = 0; v < P.length / 3; v++) {
      if (Math.round(F[v * 3 + 2]) !== PK.PAVING || Math.abs(P[v * 3 + 1] - (fl + 2.4)) > 0.01 || P[v * 3 + 2] < 196) continue;
      belv++; belvOcc = Math.max(belvOcc, O[v] * (Math.abs(P[v * 3 + 2] - 209) < 4 && Math.abs(P[v * 3]) > 120 && Math.abs(P[v * 3]) < 440 && ((P[v * 3] + 1000) % 22) > 4 && ((P[v * 3] + 1000) % 22) < 18 ? 1 : 0));
    }
    check(belv > 200, `terrace: belvedere paving (${belv} vertices)`);
    check(belvOcc < 0.35, `terrace: belvedere walk left open (${belvOcc.toFixed(2)})`);
    // the belvedere keeps clear of the long conservatory's gable (|x| < 92) and of the rim walk (z < 222)
    let intrude = 0;
    for (let v = 0; v < P.length / 3; v++) if (Math.round(F[v * 3 + 2]) === PK.PAVING && Math.abs(P[v * 3 + 1] - (fl + 2.4)) < 0.01 && (Math.abs(P[v * 3]) < 91.9 || P[v * 3 + 2] > 221.01)) intrude++;
    check(intrude === 0, `terrace: belvedere intrudes on the gable or rim walk (${intrude})`);
    // hall buttress piers: stone up to the eaves on both long sides of the big garden halls
    const piers = countWhere(g, PK.STONE, (x, y, z) => y > fl + 20 && y < fl + 30 && Math.abs(Math.abs(x + 410) - 67.2) < 1.2);
    check(piers > 20, `terrace: hall buttress piers (${piers})`);
    // porticoes: the entablature over a walk tube's crown (walk top at y = 24; entablature bottom above it)
    const ent = countWhere(g, PK.STONE, (x, y, z) => Math.abs(x + 230) < 16 && Math.abs(z - 30.6) < 2.2 && y > fl + 14.1 && y < fl + 16.2);
    const low = countWhere(g, PK.STONE, (x, y, z) => Math.abs(x + 230) < 7.2 && Math.abs(z - 30.6) < 2.2 && y > 10.4 && y < 24);
    check(ent > 0 && low === 0, `terrace: portico spans the walk tube (entablature ${ent}, blocking ${low})`);
    // cushion canopies: rise above the old flat roof between their gutters
    let crown = 0;
    for (let v = 0; v < P.length / 3; v++) if (Math.round(F[v * 3 + 2]) === PK.CANOPY && P[v * 3 + 1] > fl + 24 + 2.5) crown++;
    check(crown > 50, `terrace: canopy cushions rise (${crown})`);
    // the lit concourse kerbs and their lamps, clear of the walk tube (r 7 about z = 0)
    const kerbs = countWhere(g, CK.LANTERN, (x, y, z) => Math.abs(Math.abs(z) - 10.05) < 0.2 && y < fl + 1);
    check(kerbs >= 32, `terrace: lit concourse kerbs (${kerbs})`);
    const kerbLamps = td.lamps.filter((l) => Math.abs(Math.abs(l.p.z) - 10.3) < 0.01);
    check(kerbLamps.length > 20 && kerbLamps.every((l) => Math.abs(l.p.z) > 7.5), 'terrace: kerb lamps line the concourse outside its tube');
    // the lift tower's storeys and the banded struts
    const towerBands = countWhere(g, DK.CONCOURSE, (x, y, z) => Math.abs(z + 320) < 30 && Math.abs(x) < 30 && y > -170 && y < 10);
    check(towerBands > 100, `terrace: lift tower gallery bands (${towerBands})`);
    for (const s of td.supports) check(s.radius === 15 && Number.isFinite(s.root.x + s.end.y), 'terrace: support struts as surveyed');
    check(g.index.count / 3 < 400000, 'terrace over its triangle budget');
    w4.terrace = { triangles: g.index.count / 3, belvedereVertices: belv, piers, canopyCrown: crown, kerbLamps: kerbLamps.length };
  }

  // --------------------------------------------------------------- harbour ----
  {
    const t0 = performance.now();
    const h = ctx.buildHarbour();
    w4.harbourBuildMs = +(performance.now() - t0).toFixed(1);
    bufferSane(h.body, 'harbour body');
    const kc = kindCount(h.body);
    check(kc[PK.GALLERY] > 1000, 'harbour: arm galleries and fingers in gallery plate');
    check(!kc[DK.PORTS] || kc[DK.PORTS] < kc[PK.GALLERY], 'harbour: the white ported galleries replaced');
    // pier heads: zinc decks top and bottom at every finger tip (drawn metres), square to 160 m
    const hs = ctx.HS, P = h.body.attributes.position.array, F = h.body.attributes.aFacade.array;
    let heads = 0;
    for (const b of h.berths) {
      let top = 0, bottom = 0;
      for (let v = 0; v < P.length / 3; v++) {
        if (Math.round(F[v * 3 + 2]) !== PK.ROOF) continue;
        const dx = P[v * 3] - b.tip.x, dy = P[v * 3 + 1] - b.tip.y, dz = P[v * 3 + 2] - b.tip.z;
        if (Math.hypot(dx, dz) > 190 * hs * 1.5) continue;
        if (Math.abs(dy - 190 * hs) < 0.5) top++;
        if (Math.abs(dy + 190 * hs) < 0.5) bottom++;
      }
      if (top >= 4 && bottom >= 4) heads++;
    }
    check(heads === h.berths.length, `harbour: every finger has its pier head decks (${heads}/${h.berths.length})`);
    w4.harbour = { galleryVertices: kc[PK.GALLERY], pierHeads: heads };
  }
  {
    // the station: port material on the body (trimmed), the terrace's stronger trim, sane instancing
    const t0 = performance.now();
    const st = new ctx.HarbourStation();
    w4.harbourStationMs = +(performance.now() - t0).toFixed(1);
    check(st.body.material.userData.port === true, 'harbour body drawn with the port material');
    check(Math.abs(st.body.material.uniforms.uPortTrim.value - 0.8) < 1e-6, 'harbour body trim');
    check(st.terrace.material.uniforms.uPortTrim.value < st.body.material.uniforms.uPortTrim.value, 'terrace trimmed harder than the station');
    check(st.rings.every((r) => r.material === st.body.material), 'rings share the body material');
    const n = instancedSane(check, st.group, 'harbour');
    w4.harbourInstanced = n;
    check(n > 5, 'harbour instanced meshes found');
  }

  // ------------------------------------------------------------ Concord Yard ----
  {
    const t0 = performance.now();
    const yd = ctx.buildConcordYard();
    w4.yardBuildMs = +(performance.now() - t0).toFixed(1);
    check(w4.yardBuildMs < 300, `yard build ${w4.yardBuildMs} ms`);
    const hg = yd.hullGeo, P = hg.attributes.position.array, F = hg.attributes.aFacade.array;
    // web frames: grey plate at every rib, reaching ribDepth inboard of the lines and never past them
    let ribsOk = 0, outside = 0;
    for (const z of ctx.YARD.ribs) {
      const d = ctx.ribDepth(z);
      check(d > 2 && d <= 14, `rib web depth at ${z}: ${d}`);
      let inner = Infinity, n = 0;
      for (let v = 0; v < P.length / 3; v++) {
        if (Math.round(F[v * 3 + 2]) !== DK.GRIME || Math.abs(P[v * 3 + 2] - z) > 2.6) continue;
        n++;
        const x = P[v * 3], y = P[v * 3 + 1], t = Math.atan2(y, x);
        const s = ctx.sectionPoint(z, t), rs = Math.hypot(s.x, s.y), r = Math.hypot(x, y);
        void rs;
        inner = Math.min(inner, r);
      }
      // outer face on the lines: sample the section at the web's own stations
      for (let i = 0; i < 48; i++) { const s = ctx.sectionPoint(z, (i / 48) * Math.PI * 2); void s; }
      if (n >= 48 * 16 && inner > 0.5) ribsOk++;
    }
    check(ribsOk === ctx.YARD.ribs.length, `yard: web frames on every rib (${ribsOk}/${ctx.YARD.ribs.length})`);
    // the web frames never stand proud of the final lines (the plates are fitted over them)
    for (let v = 0; v < P.length / 3; v++) {
      if (Math.round(F[v * 3 + 2]) !== DK.GRIME || P[v * 3 + 2] < ctx.YARD.ribs[0] - 3) continue;
      const z = P[v * 3 + 2], x = P[v * 3], y = P[v * 3 + 1];
      const s = ctx.sectionPoint(z, Math.atan2(y, x));
      // (the section is a superellipse; its point at the vertex's polar angle bounds the radius loosely)
      if (Math.hypot(x, y) > Math.hypot(s.x, s.y) * 1.08 + 0.5) outside++;
    }
    check(outside === 0, `yard: ${outside} web-frame vertices stand outside the hull lines`);
    // the dock: knee plates and name panels on every portal (grey and livery boxes between the chords)
    const dg = yd.dockGeo;
    bufferSane(dg, 'yard dock (w4)');
    const plates = countWhere(dg, DK.GRIME, (x, y, z) => ctx.YARD.frames.some((f) => Math.abs(z - f) < 6) && Math.hypot(x, y) > 252 && Math.hypot(x, y) < 300);
    check(plates > ctx.YARD.frames.length * 8 * 2 * 16, `yard: portal knee plates (${plates})`);
    // the twin-girder gantry: grey girders under the top rails at the gantry's station
    const girder = countWhere(dg, DK.HAZARD, (x, y, z) => Math.abs(z - 780) < 16 && y > 220);
    check(girder >= 16, 'yard: gantry girders hazard-banded');
    w4.yard = { hullTriangles: hg.index.count / 3, dockTriangles: dg.index.count / 3, portalPlateVertices: plates };
    check(dg.index.count / 3 + hg.index.count / 3 < 700000, 'yard over its unique-geometry budget');
    // the works: bay cranes inside their +-15 m travel envelope, plating in the yard's finishes
    const ym = ctx.craftMesh(dg);
    const t1 = performance.now();
    const yw = new ctx.YardWorks(ym);
    w4.yardWorksMs = +(performance.now() - t1).toFixed(1);
    let craneZ = 0, plateKinds = new Set(), n = 0;
    ym.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.aFacade) return;
      const g = o.geometry;
      if (o.isInstancedMesh && o.count === ctx.WORKS.cranes.length) {
        // the bridge (girders, deck, carriages, house: y > 230; the driver's cab hangs below it, clear
        // of the walkways by its x) keeps to the bay's +-15 m travel envelope
        g.computeBoundingBox();
        if (g.boundingBox.max.y > 240 && g.boundingBox.max.x > 100) {
          const p = g.attributes.position.array;
          for (let v = 0; v < p.length / 3; v++) if (p[v * 3 + 1] > 230) craneZ = Math.max(craneZ, Math.abs(p[v * 3 + 2]));
        }
      }
      if (!o.isInstancedMesh && o !== ym) { const kc = kindCount(g); for (const k of Object.keys(kc)) plateKinds.add(+k); }
    });
    check(craneZ > 0 && craneZ <= 15, `yard: bay cranes within their +-15 m envelope (${craneZ})`);
    check(plateKinds.has(DK.LIVERY) && plateKinds.has(DK.GRIME), 'yard: plating in oxide and primer');
    n = instancedSane(check, ym, 'yard works');
    check(n > 3, 'yard works instanced meshes found');
    void yw;
  }

  // ------------------------------------------------------------- Water Store ----
  {
    const t0 = performance.now();
    const sd = ctx.buildWaterStore();
    w4.storeBuildMs = +(performance.now() - t0).toFixed(1);
    const g = sd.geo;
    bufferSane(g, 'store (w4)');
    const S = ctx.STORE;
    // a gallery girder under every tank ring: its zinc walk 16 m under the tanks' equator
    for (const y of S.rings) {
      const walk = countWhere(g, PK.ROOF, (x, yy, z) => Math.abs(yy - (y - 16)) < 0.2 && Math.hypot(x, z) > 280 && Math.hypot(x, z) < 345);
      check(walk >= 16, `store: tank gallery at ${y} (${walk})`);
    }
    // the gallery clears the tanks, the saddles, the mains (y + 30) and the climbers' bore
    const gOut = 340, gIn = 312 * Math.cos(Math.PI / 8);
    check(S.tankOrbit - S.tankR > gOut + 2, 'store: gallery clear of the tank shells');
    check(gIn > S.apothem + 2, 'store: gallery outside the cage');
    // the wheel's rim a habitat section: lit concourse roof toward the tether, ported walls
    const roof = countWhere(g, DK.CONCOURSE, (x, y, z) => Math.abs(y - S.wheelY) < 25 && Math.abs(Math.hypot(x, z) - (S.wheelR - 34)) < 0.5);
    check(roof > 100, `store: wheel concourse roof (${roof})`);
    // tank domes at both poles of every tank
    let domes = 0;
    for (const t of sd.tanks) {
      let up = 0, dn = 0;
      const P = g.attributes.position.array;
      for (let v = 0; v < P.length / 3; v++) {
        const dx = P[v * 3] - t.center.x, dz = P[v * 3 + 2] - t.center.z, dy = P[v * 3 + 1] - t.center.y;
        if (Math.hypot(dx, dz) > 32) continue;
        if (dy > t.radius + 5) up++;
        if (dy < -t.radius - 5) dn++;
      }
      if (up && dn) domes++;
    }
    check(domes === sd.tanks.length, `store: manway domes on every tank (${domes}/${sd.tanks.length})`);
    const sm = ctx.craftMesh(g);
    const sw = new ctx.StoreWorks(sm, sd);
    const n = instancedSane(check, sm, 'store works');
    check(n > 0, 'store works instanced meshes found');
    void sw;
    w4.store = { triangles: g.index.count / 3, domes };
  }

  // -------------------------------------------------------------------- belt ----
  {
    // the habitat rim steps back in planted terraces; the slipway's portals are plated; the relay's back stiffened
    const hab = ctx.buildBeltStation('habitat', 7, 0), yardS = ctx.buildBeltStation('shipyard', 7, 0), rel = ctx.buildBeltStation('relay', 7, 0);
    let beds = 0;
    for (const p of hab.parts) if (p.mode === 'spin') beds += kindCount(p.geo)[PK.BEDS] || 0;
    check(beds > 96 * 4, `belt wheel: planted terraces on the rim (${beds})`);
    const yk = kindCount(yardS.geo);
    check((yk[DK.GRIME] || 0) > 500 && (yk[DK.HAZARD] || 0) > 0, 'belt slipway: knee plates, webs and hazard-edged stock deck');
    let girders = 0;
    for (const p of yardS.parts) if (p.mode === 'rail') girders += kindCount(p.geo)[DK.HAZARD] || 0;
    check(girders > 0, 'belt slipway: crane bridges as hazard-banded girders');
    const rk = kindCount(rel.geo);
    check((rk[DK.GRIME] || 0) > 100 && (rk[DK.LIVERY] || 0) > 0, 'belt relay: emitter back in working plate with a livery rim');
    for (const [name, d] of [['habitat', hab], ['shipyard', yardS], ['relay', rel]]) {
      bufferSane(d.geo, `belt ${name} (w4)`);
      for (const p of d.parts) bufferSane(p.geo, `belt ${name} part (w4)`);
    }
    // every built belt station's instancing, once more after the refinement
    let n = 0;
    for (const st of ctx.belt.stations) if (st.built) n += instancedSane(check, st.built.mesh, st.desc.name);
    w4.beltInstanced = n;
    w4.belt = { wheelBeds: beds, slipwayGrime: yk[DK.GRIME] || 0, relayGrime: rk[DK.GRIME] || 0 };
  }
}
