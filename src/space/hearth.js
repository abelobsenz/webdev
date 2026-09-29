import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { U } from '../core/uniforms.js';
import { SKY_UNIFORMS } from './sky.js';
import { createHullMaterial, tag, merge, beam, KIND } from './hull.js';
import { CB } from '../craft/craftGeometry.js';
import { HearthWorks, FEEDER_IMPACT } from './hearthWorks.js';
import { RS, M_KM, BH_FRAG, COMP_FRAG, createLensTarget } from './hearthLens.js';
import { HearthDistrict } from './hearthDistrict.js';

// THE HEARTH: a spinning black hole (a = 0.7) kept on a halo orbit around Sun-Earth L2,
// with its accretion disc, the collector ring that turns the disc's light into power, the
// Refuge where the crews live and the feeder that keeps the disc supplied. The hole's image
// (Kerr geodesics, the disc's Doppler and gravitational shifts, the lensed sky) is ray traced
// by src/space/hearthLens.js into bhRT, which the backdrop composite and the masks read.

export { RS };

export function buildCollector() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [];
  const S = 0.32;
  // A continuous mirror/back shell, including the rim return. +X faces the hole.
  const B = new CB(), profile = [];
  for (let i=0;i<=16;i++) { const a=i/16*.72; profile.push([40*Math.sin(a),40*(1-Math.cos(a)),KIND.MIRROR]); }
  for (let i=16;i>=0;i--) { const a=i/16*.72; profile.push([40.6*Math.sin(a),39.8-40.6*Math.cos(a),KIND.TRUSS]); }
  B.lathe(profile,64,0,{closedProfile:true});
  const shell = B.geometry();
  shell.rotateY(Math.PI/2);
  shell.setAttribute('aKind',new THREE.Float32BufferAttribute(Array.from({length:shell.attributes.position.count},(_,i)=>shell.attributes.aFacade.getZ(i)),1));
  shell.deleteAttribute('aFacade');
  shell.setAttribute('aSurface',new THREE.Float32BufferAttribute(new Float32Array(shell.attributes.position.count*2),2));
  parts.push(shell.toNonIndexed());
  for(let k=0;k<12;k++) {
    const a=k/12*Math.PI*2;
    parts.push(beam(V(-1.4,Math.cos(a)*.6,Math.sin(a)*.6),V(7.8,Math.cos(a)*24,Math.sin(a)*24),.32,KIND.TRUSS,6));
  }
  // receiver on a boom at the focus, in front of the concave face
  parts.push(beam(V(-1, 0, 0), V(19, 0, 0), 0.6, KIND.TRUSS, 6));
  for (const a of [0, 2.1, 4.2]) parts.push(beam(V(8, Math.cos(a) * 24, Math.sin(a) * 24), V(19, 0, 0), 0.35, KIND.TRUSS, 6));
  parts.push(tag(new THREE.SphereGeometry(2.2, 16, 12).translate(20, 0, 0), KIND.GLOW));
  // hab and radiators behind the dish
  parts.push(tag(new THREE.CylinderGeometry(3, 3, 14, 16).rotateZ(Math.PI / 2).translate(-9, 0, 0), KIND.HAB));
  parts.push(beam(V(-3,0,0),V(0,0,0),2.3,KIND.GOLD,16));
  for (const s of [-1, 1]) {
    parts.push(tag(new THREE.BoxGeometry(10, 0.2, 34).translate(-13, 0, s * 26), KIND.PANEL));
  }
  parts.push(beam(V(-13,0,-26),V(-13,0,26),.45,KIND.TRUSS,6));
  const g = merge(parts);
  g.scale(S, S, S);
  g.computeBoundingSphere();
  return g;
}

/** Closed pressure refuges and a visible mirror-servicing yard, in kilometres. */
export function buildHearthRefuge(origin=new THREE.Vector3()) {
  const V=(x,y,z)=>new THREE.Vector3(x,y,z), galleries=[], docks=[],rotors=[];
  let parts=[];
  const at=(p)=>p.clone().add(origin);
  const box=(p,size,k)=>parts.push(tag(new THREE.BoxGeometry(...size).translate(...at(p).toArray()),k));
  const strut=(a,b,r,k=KIND.TRUSS)=>parts.push(beam(at(a),at(b),r,k,8));
  const ring=(r,tube,y,k,segs=120)=>parts.push(tag(new THREE.TorusGeometry(r,tube,12,segs).rotateX(Math.PI/2).translate(origin.x,origin.y+y,origin.z),k));
  parts.push(tag(new THREE.CylinderGeometry(1.7,1.7,32,32).translate(...origin.toArray()),KIND.HAB));
  // The shield collars and dark service decks give the spindle a readable hierarchy.
  for(const y of [-14,-10,-5,0,5,10,14]) {ring(1.74,.24,y,KIND.GOLD,48);ring(1.76,.14,y+.36,KIND.PANEL,48);}
  for(const y of [-16,16]) parts.push(tag(new THREE.SphereGeometry(1.72,28,16).scale(1,.45,1).translate(origin.x,origin.y+y,origin.z),KIND.GOLD));
  const sleeve=(inner,outer,half,y,k)=>{
    const b=new CB();b.lathe([[inner,-half,k],[outer,-half,k],[outer,half,k],[inner,half,k]],96,0,{closedProfile:true});
    parts.push(tag(b.geometry().rotateX(-Math.PI/2).translate(origin.x,origin.y+y,origin.z),k));
  };
  for(const y of [-8,8]) {
    // A stationary stator is seated in the spindle. Its field faces stop short of the
    // rotating transfer collar: every spoke and garden belongs to the rotating side.
    sleeve(1.62,1.77,.48,y,KIND.GOLD);
    for(const dy of [-.4,.4])ring(1.742,.02,y+dy,KIND.GLOW,96);
    const stationary=parts;parts=[];
    sleeve(1.82,2.08,.58,y,KIND.GOLD);
    for(const dy of [-.46,.46])ring(2.055,.075,y+dy,KIND.HAB,96);
    ring(12,1.25,y,KIND.HAB);
    // Occupied glazed galleries nest into the pressure hull, with protective ribs.
    ring(12.7,.62,y+.45,KIND.PANEL);
    ring(11.25,.36,y+.1,KIND.PANEL);
    ring(12.25,.12,y+1.2,KIND.GOLD);
    for(let k=0;k<32;k++) {
      const a=k/32*Math.PI*2,rad=V(Math.cos(a),0,Math.sin(a));
      const c=at(rad.clone().multiplyScalar(12).setY(y));
      parts.push(tag(new THREE.TorusGeometry(1.29,.07,6,24).rotateY(-a).translate(...c.toArray()),KIND.GOLD));
    }
    for(let k=0;k<6;k++) {
      const a=k/6*Math.PI*2,rad=V(Math.cos(a),0,Math.sin(a));
      const inner=rad.clone().multiplyScalar(2.0).setY(y),outer=rad.clone().multiplyScalar(12).setY(y);
      strut(inner,outer,.3,KIND.HAB);
      const c=rad.clone().multiplyScalar(6.8).setY(y);
      parts.push(tag(new THREE.SphereGeometry(1.25,24,12).scale(1,.65,1).translate(...at(c).toArray()),KIND.GARDEN));
      galleries.push({center:rad.clone().multiplyScalar(6.8),radius:1.25,rotor:rotors.length});
      // Radiation shutters articulate the roof as petal-like shields around each garden.
      for(const sd of [-1,1]) {
        const q=c.clone().add(V(-rad.z,0,rad.x).multiplyScalar(sd*.98));
        const g=new THREE.BoxGeometry(.45,.1,1.7).rotateY(-a).translate(...at(q.clone().add(V(0,.48,0))).toArray());parts.push(tag(g,KIND.GOLD));
      }
      strut(inner.clone().add(V(0,.6,0)),outer.clone().add(V(0,.6,0)),.065,KIND.GOLD);
    }
    rotors.push({geo:merge(parts).translate(-origin.x,-origin.y-y,-origin.z),y,dir:y<0?1:-1,floorRadius:13.25,omega:Math.sqrt(9.81/13250)});
    parts=stationary;
  }
  // Two low service galleries pass through the spindle and feed framed repair racks.
  strut(V(-20,0,0),V(20,0,0),.6,KIND.HAB);
  for(const sd of [-1,1]) {
    const x=sd*20;
    strut(V(x,-11,0),V(x,10,0),.4);
    for(let j=0;j<4;j++) {
      const y=-9+j*6;
      box(V(x,y,0),[7,.18,5],KIND.MIRROR);
      const frame=new CB();
      frame.tube([V(x-3.55,y,-2.55),V(x+3.55,y,-2.55),V(x+3.55,y,2.55),V(x-3.55,y,2.55),V(x-3.55,y,-2.55)].map(at),.11,8,KIND.GOLD);
      parts.push(tag(frame.geometry(),KIND.GOLD));
      // Handling spine, motor sled and four seated clamps: mirrors are replaceable stock.
      strut(V(x,y-.3,-2.4),V(x,y-.3,2.4),.16);
      box(V(x,y+.18,0),[.8,.35,.7],KIND.HAB);
      for(const dx of [-2.8,2.8])for(const dz of [-2,2])box(V(x+dx,y+.16,dz),[.38,.3,.46],KIND.GOLD);
    }
    for(const dz of [-2.5,2.5]) strut(V(x,-9,dz),V(x,9,dz),.13);
    // Lower handling deck and a separately supported docking sleeve, clear of mirror stock.
    box(V(x,-11,0),[8.4,.5,6.2],KIND.PLATE);
    strut(V(x,-11,0),V(x,-11,7),.38,KIND.HAB);
    box(V(x,-11,6),[4,.25,3],KIND.PLATE);
    for(const dx of [-1.5,1.5])strut(V(x+dx,-10.8,5),V(x+dx,-9,5),.14,KIND.GOLD);
    docks.push({center:at(V(x,-10.5,7)),halfWidth:1.2});
  }
  // Paired radiator leaves are structurally carried off the spindle, clear of the wheels.
  for(const sd of [-1,1]) {
    strut(V(0,0,1.5*sd),V(0,0,17*sd),.24);
    box(V(0,0,15.8*sd),[9.2,.16,2.8],KIND.PANEL);
    for(let j=-4;j<=4;j+=2)strut(V(j,0,14.35*sd),V(j,0,17.25*sd),.065,KIND.GOLD);
  }
  return {geo:merge(parts),galleries,docks,rotors};
}

/** Incoming gallery stays below both complete rotor envelopes, then enters the spindle. */
export function buildRefugeApproach(root) {
  const lower=new THREE.Vector3(0,-20,0),entry=new THREE.Vector3(0,-15.2,0);
  const parts=[beam(root,lower,.7,KIND.HAB,16),beam(lower,entry,.7,KIND.HAB,16)];
  parts.push(tag(new THREE.SphereGeometry(1.03,32,20).translate(...lower.toArray()),KIND.GOLD));
  // A lower transfer collar carries the bend and the lift mouth at the spindle's pole.
  for(const y of [-19.8,-18.8,-17.8])parts.push(tag(new THREE.TorusGeometry(.72,.085,8,48).rotateX(Math.PI/2).translate(0,y,0),KIND.GOLD));
  return {geo:merge(parts),path:[root.clone(),lower,entry],radius:.7};
}

export class Hearth {
  constructor(space, q) {
    this.space = space;
    this.q = q;
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.3, -0.18));
    this.group = new THREE.Group();
    // the lens pass: disc light + opacity, and the bending of every ray (src/space/hearthLens.js)
    this.bhRT = createLensTarget();
    this.uniforms = {
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uToBH: { value: new THREE.Matrix3() },
      uCamBH: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLensR: { value: 0 },
      uDiscGain: { value: 5.0 }, uGObs: { value: 1 }, uPixAng: { value: 1e-3 }, uFeed: { value: new THREE.Vector3(0, 0, 1) }, uJet: { value: 1 },
    };
    this.bhMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: BH_FRAG, uniforms: this.uniforms, defines: { STEPS: q.bhSteps }, depthTest: false, depthWrite: false });
    this.pass = new FullscreenPass(this.bhMat);
    // composite quad, drawn in the backdrop scene: the lensed sky at full resolution behind the disc
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    cgeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const u = this.uniforms;
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: COMP_FRAG,
      uniforms: {
        tDisc: { value: this.bhRT.textures[0] }, tLens: { value: this.bhRT.textures[1] }, uInvProj: u.uInvProj, uCamRot: u.uCamRot,
        uCamW: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
        uEarthPos: { value: new THREE.Vector3() }, uMoonPos: { value: new THREE.Vector3() }, ...SKY_UNIFORMS,
      },
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.composite = new THREE.Mesh(cgeo, this.compMat);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -900;
    // collector ring: 14 mirror stations and a thin structural ring at 30 horizon radii
    this.hullMat = createHullMaterial({ pattern: 0.08, accent: [1.0, 0.7, 0.4], behindMask: true });
    this.hullMat.uniforms.uHearthTex.value = this.bhRT.texture;
    this.stations = new THREE.Group();
    const cgeo2 = buildCollector();
    const N = 14;
    const Rc = 30 * RS;
    this.collectorMounts = [];
    const supports = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const m = new THREE.Mesh(cgeo2, this.hullMat);
      m.position.set(Math.cos(a) * Rc, Math.sin(a * 3) * 18, Math.sin(a) * Rc);
      m.lookAt(0, 0, 0);
      m.rotateY(-Math.PI / 2);
      m.updateMatrix();
      const mount = new THREE.Vector3(-12*.32,0,0).applyMatrix4(m.matrix);
      const root = new THREE.Vector3(Math.cos(a)*Rc,0,Math.sin(a)*Rc);
      supports.push(beam(root,mount,.55,KIND.HAB,8));
      for(const sd of [-1,1]) {
        const brace = new THREE.Vector3(Math.cos(a+sd*.006)*Rc,0,Math.sin(a+sd*.006)*Rc);
        supports.push(beam(brace,mount,.2,KIND.TRUSS,6));
      }
      this.collectorMounts.push({ root, mount, collector:m });
      this.stations.add(m);
    }
    const ring = [tag(new THREE.TorusGeometry(Rc, 0.45, 6, 720).rotateX(Math.PI / 2), KIND.TRUSS), tag(new THREE.TorusGeometry(Rc, 0.15, 4, 720).rotateX(Math.PI / 2).translate(0, 0.7, 0), KIND.GLOW)];
    this.stations.add(new THREE.Mesh(merge([...ring,...supports]), this.hullMat));
    // A maintenance refuge outside the energy collector line: two inhabited rings,
    // spare mirror racks and a shaded service spine. The disc's great void stays clear.
    const angle=.82;
    this.refugePosition = new THREE.Vector3(Math.cos(angle)*944,32,Math.sin(angle)*944);
    const refugeRoot = new THREE.Vector3(Math.cos(angle)*Rc,0,Math.sin(angle)*Rc);
    this.refugeData=buildHearthRefuge();
    this.refugeApproach=buildRefugeApproach(refugeRoot.clone().sub(this.refugePosition));
    this.refuge=new THREE.Group();this.refuge.position.copy(this.refugePosition);
    this.refugeFixed=new THREE.Mesh(merge([this.refugeApproach.geo,this.refugeData.geo]),this.hullMat);
    this.refuge.add(this.refugeFixed);
    this.refugeRotors=this.refugeData.rotors.map(r=>{
      const mesh=new THREE.Mesh(r.geo,this.hullMat);mesh.position.y=r.y;mesh.userData={dir:r.dir,omega:r.omega};this.refuge.add(mesh);return mesh;
    });
    this.stations.add(this.refuge);
    this.stations.rotation.z = 0.12;
    this.stations.traverse((o) => { o.frustumCulled = false; o.renderOrder = 3; });
    this.group.add(this.stations);
    // docked carriers, gallery shuttles and the feeder with its matter stream (src/space/hearthWorks.js)
    this.works = new HearthWorks(this);
    // collector-station modules, ring trams, feeder tankers and wheel lights (src/space/hearthDistrict.js)
    this.district = new HearthDistrict(this);
    this.mode = 'far';
    this.scale = 1;
    this.size = new THREE.Vector2(1, 1);
    this.active = true;
    this.coverage = 0;
    this._rel = new THREE.Vector3(); this._fwd = new THREE.Vector3(); this._inv = new THREE.Quaternion(); this._m4 = new THREE.Matrix4();
  }

  setQuality(q) { this.q = q; this.bhMat.defines.STEPS = q.bhSteps; this.bhMat.needsUpdate = true; }
  setSize(w, h) { this.size.set(w, h); this._resize(); if (this.works) this.works.setSize(w, h); }
  _resize() {
    const w = Math.max(1, Math.round(this.size.x * this.scale)), h = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.bhRT.width !== w || this.bhRT.height !== h) this.bhRT.setSize(w, h);
    this.hullMat.uniforms.uHearthRes.value.set(this.size.x, this.size.y);
  }

  get nearZone() { return this.mode === 'near'; }

  update(sim, realTime, dt, space) {
    for(const rotor of this.refugeRotors)rotor.rotation.y=(realTime*rotor.userData.omega*rotor.userData.dir)%(Math.PI*2);
    if (this.works) this.works.update(sim, realTime);
    if (this.district) this.district.update(realTime);
    this.group.position.copy(sim.hearthPos);
    this.group.quaternion.copy(this.quat);
    this.group.updateMatrixWorld(true);
    const cam = space.camera;
    const rel = this._rel.copy(cam.position).sub(sim.hearthPos);
    const d = rel.length();
    this.distance = d;
    // near zone: the lensed image fills the screen and replaces the backdrop
    this.mode = d < 2500 * RS ? 'near' : 'far';
    const lensR = this.mode === 'near' ? 0 : 320 * RS;           // km
    const angR = Math.asin(Math.min(1, lensR / d));
    const fov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    this.coverage = this.mode === 'near' ? 1 : Math.min(1, (angR * angR) / (fov * fov * cam.aspect));
    // on screen?
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const offAng = Math.acos(THREE.MathUtils.clamp(-rel.dot(fwd) / d, -1, 1));
    this.visibleOnScreen = this.mode === 'near' || offAng < angR + fov * 1.6;
    // tiny on screen: skip the ray march entirely (the swarm-like glint in the sky suffices)
    this.active = this.visibleOnScreen && (this.mode === 'near' || angR / fov > 0.004);
    const want = this.mode === 'near' || this.coverage > 0.35 ? this.q.bhScale : 1.0;
    if (want !== this.scale) { this.scale = want; this._resize(); }
    const u = this.uniforms, cu = this.compMat.uniforms;
    u.uTime.value = realTime;
    u.uLensR.value = lensR / M_KM;
    const inv = this._inv.copy(this.quat).invert();
    u.uToBH.value.setFromMatrix4(this._m4.makeRotationFromQuaternion(inv));
    u.uCamBH.value.copy(rel).applyQuaternion(inv).multiplyScalar(1 / M_KM);
    // a static observer deep in the well sees everything a little blueshifted
    u.uGObs.value = 1 / Math.sqrt(Math.max(1 - 2 * M_KM / d, 0.05));
    u.uFeed.value.set(FEEDER_IMPACT.r / M_KM, FEEDER_IMPACT.phiBL, 1);
    cu.uSunDir.value.copy(sim.sunDir);
    cu.uEarthPos.value.set(0, 0, 0);
    cu.uMoonPos.value.copy(sim.moonPos);
    cu.uCamW.value.copy(cam.position);
    const hu = this.hullMat.uniforms;
    hu.uSunDir.value.copy(sim.sunDir);
    hu.uTime.value = realTime;
    hu.uEarthPos.value.set(0, 0, 0);
    // the disc's light: a warm white source (its integrated colour), falling off as 1/d^2 beyond
    // the collector ring's radius
    hu.uPointPos.value.copy(sim.hearthPos);
    hu.uPointColor.value.setRGB(1.0, 0.8, 0.6).multiplyScalar(6.0);
    if (hu.uPointRef) hu.uPointRef.value = 30 * RS;
    hu.uHearthDepth.value = d;
  }

  /** Ray-march into bhRT; called before the space scene renders. */
  renderLens(renderer, cam) {
    this.composite.visible = this.active;
    if (!this.active) { this.hullMat.uniforms.uBehindMask.value = 0; return; }
    const u = this.uniforms;
    cam.updateMatrixWorld();
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    u.uPixAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / Math.max(this.bhRT.height, 1);
    const prev = renderer.getRenderTarget();
    this.pass.render(renderer, this.bhRT);
    renderer.setRenderTarget(prev);
    this.hullMat.uniforms.uBehindMask.value = 1;
  }

  exposureHint() { return this.active ? Math.min(0.75, this.coverage * 1.4 + (this.mode === 'near' ? 0.25 : 0)) : 0; }
}
