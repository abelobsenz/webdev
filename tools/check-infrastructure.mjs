import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extrudeAlong, maglevStation, deckPortal, buildInfrastructure } from '../src/world/infrastructure.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { auditGeometry } from './geometry-audit.mjs';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const square=[[-2,-1],[2,-1],[2,1],[-2,1]];
const open=[V(0,0,0),V(10,0,0),V(20,3,8),V(32,6,12)];
const ring=Array.from({length:65},(_,i)=>V(30*Math.cos(i/64*Math.PI*2),3*Math.sin(i/64*Math.PI*4),30*Math.sin(i/64*Math.PI*2)));
const cases=[['clockwise open path',open,[...square].reverse()],['counterclockwise open path',open,square],['vertical path',[V(0,0,0),V(0,5,0)],square],['periodic viaduct',ring,square],['facade seam repetitions',open,[square[0],square[1],square[1],square[2],square[3]]]];
const control=auditGeometry(extrudeAlong(open,square,()=>1,{caps:false}));
assert.equal(control.boundaryEdges,8,'uncapped extrusion positive control');
for(const [name,path,section] of cases) {
 const g=extrudeAlong(path,section,()=>1), a=auditGeometry(g);
 assert.equal(a.boundaryEdges,0,`${name}: closed boundaries`);
 assert.equal(a.nonManifoldEdges,0,`${name}: manifold surface`);
 assert.equal(a.inconsistentEdges,0,`${name}: consistent winding`);
 assert.equal(a.nonFinite+a.invalidNormals+a.degenerates,0,`${name}: valid triangles and normals`);
 assert.ok(a.signedVolume>0,`${name}: outward volume`);
 console.log(name,JSON.stringify(a));
}
const mesh=new THREE.Mesh(extrudeAlong(ring,square,()=>1),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
mesh.updateMatrixWorld();
assert.equal(new THREE.Raycaster(V(0,100,0),V(0,-1,0)).intersectObject(mesh).length,0,'periodic deck preserves central aperture');
for (const yaw of [0,.37,2.1]) {
 const centre=V(16000,0,-17000), direction=V(Math.cos(yaw),0,Math.sin(yaw)), side=V(-Math.sin(yaw),0,Math.cos(yaw));
 const parts=[];maglevStation(parts,centre,direction,side,9,1,0);
 const station=new THREE.Group();
 for (const [i,g] of parts.entries()) {
  const a=auditGeometry(g,{tolerance:1e-3});
  assert.equal(a.boundaryEdges+a.inconsistentEdges+a.nonManifoldEdges+a.nonFinite+a.invalidNormals,0,`terminal ${yaw}/${i}: closed material`);
  assert.ok(a.signedVolume>0,`terminal ${yaw}/${i}: outward material`);
  station.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
 }
 station.updateMatrixWorld();
 for (const lateral of [-2,0,2]) {
  const origin=centre.clone().addScaledVector(direction,55).addScaledVector(side,lateral).setY(11);
  const ray=new THREE.Raycaster(origin,direction.clone().negate(),0,54);
  assert.equal(ray.intersectObject(station,true).length,0,`terminal ${yaw}: usable train entrance at ${lateral}m`);
 }
 console.log(`terminal ${yaw}: ${parts.length} closed components and clear entrance`);
}
const sampler=new HeightSampler(await buildTerrainData());
// Portal arch endpoints must join the columns at their actual elevation. The
// old builder added the deck elevation twice and detached both arch members.
for (const base of [9.2,16.2,67.4]) for (const yaw of [0,.77,2.6]) for (const founded of [false,true]) {
 const p=V(21000,base-.2,-19000),side=V(Math.cos(yaw),0,Math.sin(yaw)),parts=[];
 const floor=(x,z)=>-24+(x-21000)*.18+(z+19000)*.22;
 deckPortal(parts,p,side,base,founded?floor:null);
 const pylons=parts.slice(0,2).map(g=>new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
 pylons.forEach(m=>m.updateMatrixWorld());
 for(const [member,radial]of [[2,8],[3,6]])for(const [end,column]of [[0,0],[24,1]]){
  const pos=parts[member].attributes.position,centre=new THREE.Vector3();
  for(let i=0;i<radial;i++)centre.add(new THREE.Vector3().fromBufferAttribute(pos,end*(radial+1)+i));centre.divideScalar(radial);
  const ray=new THREE.Raycaster(centre,side,0,2);
  assert.ok(ray.intersectObject(pylons[column],false).length,'both actual portal arch ends are embedded in their pylons');
  ray.ray.origin.y+=p.y;
  assert.equal(ray.intersectObject(pylons[column],false).length,0,'positive control: adding the deck elevation again detaches the member');
 }
 if(founded)for(const g of parts.slice(0,2)){
  const pos=g.attributes.position;g.computeBoundingBox();
  for(let i=0;i<pos.count;i++)if(pos.getY(i)<g.boundingBox.min.y+.01)assert.ok(pos.getY(i)<floor(pos.getX(i),pos.getZ(i))-.8,'complete portal footing is embedded in sloping seabed');
 }
}
const raw=(x,z)=>sampler.get(x,z), ground=(x,z)=>Math.max(0,raw(x,z));
const city=new THREE.Scene(), infrastructure=buildInfrastructure(city,ground,raw);
for (const [i,m] of city.children.filter(o=>o.isMesh).entries()) {
 const a=auditGeometry(m.geometry,{tolerance:1e-4});
 assert.equal(a.boundaryEdges+a.inconsistentEdges+a.nonManifoldEdges+a.nonFinite+a.invalidNormals+a.degenerates,0,`${m.name||i}: full production infrastructure closure`);
 assert.ok(a.signedVolume>0,`${m.name||i}: outward volume`);
}
assert.equal(infrastructure.pads.length,34,'all thirty-four lagoon platforms retained');
for (const pad of infrastructure.pads) {
 for (const fraction of [.25,.5,.75,1]) for(let i=0;i<64;i++) {
  const a=i/64*Math.PI*2,r=pad.r*1.085*fraction;
  assert.ok(raw(pad.x+Math.cos(a)*r,pad.z+Math.sin(a)*r)<-2.5,'lotus footprint stays clear of shore');
 }
 for (const path of infrastructure.promenades) for(let k=1;k<path.length;k++) {
  const a=path[k-1],b=path[k],dx=b.x-a.x,dz=b.z-a.z;
  const u=Math.max(0,Math.min(1,((pad.x-a.x)*dx+(pad.z-a.z)*dz)/(dx*dx+dz*dz)));
  assert.ok(Math.hypot(pad.x-a.x-u*dx,pad.z-a.z-u*dz)>pad.r*1.085+17,'lotus does not intersect promenade deck');
 }
}
console.log('Full promenade, Gate, lotus, skyport and ship meshes closed; 34 lagoon footprints clear');
console.log('INFRASTRUCTURE_SOLIDS_OK');
