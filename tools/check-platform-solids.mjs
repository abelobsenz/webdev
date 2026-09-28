import assert from 'node:assert/strict';
import { sweepLoop, fixWinding } from '../src/world/platform.js';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';
import * as THREE from 'three';
import { CROWN_BUILDERS } from '../src/world/crowns.js';
import { wardRecords, wardTowerDefs } from '../src/world/metro.js';
import { buildTransit } from '../src/world/transit.js';
import { mulberry32 } from '../src/world/noise.js';
import { outerCities, renderedHeight } from '../src/world/outerCities.js';
import { buildMassifTowns } from '../src/world/massifTowns.js';
const section=()=>[{a:[2,-4],b:[2,3],kind:1},{a:[2,3],b:[-2,3],kind:9},{a:[-2,3],b:[-2,-4],kind:1}];
const cases=[['straight pier',[[0,0],[20,0]],{closed:false}],['curved quay',[[0,0],[15,0],[25,10],[25,25]],{closed:false}],['ring retaining volume',Array.from({length:32},(_,i)=>[Math.cos(i/32*Math.PI*2)*20,Math.sin(i/32*Math.PI*2)*20]),{closed:true}]];
assert.ok(auditGeometry(sweepLoop([[0,0],[20,0]],section,{closed:false})).boundaryEdges>0,'open sweep positive control');
for(const [name,path,options] of cases) for (const reverseSection of [false,true]) for (const reversePath of [false,true]) {
 const profile=()=>reverseSection?section().reverse().map(f=>({...f,a:f.b,b:f.a})):section();
 const g=sweepLoop(reversePath?path.slice().reverse():path,profile,{...options,closeSection:true,capEnds:true});
 const r=auditGeometry(g);
 assert.equal(r.boundaryEdges,0,`${name}: boundary closure`);
 assert.equal(r.nonManifoldEdges,0,`${name}: manifold material`);
 assert.equal(r.inconsistentEdges,0,`${name}: consistent winding`);
 assert.equal(r.nonFinite+r.invalidNormals,0,`${name}: valid attributes`);
 assert.ok(r.signedVolume>0,`${name}: outward signed volume`);
 if (!reverseSection && !reversePath) console.log(name,JSON.stringify(r));
}
// A mirrored profile used to close geometrically but leave its end caps
// inconsistent with the inward-facing side walls. Catch that exact failure.
{
 const inward=()=>section().reverse().map(f=>({...f,a:f.b,b:f.a}));
 const legacy=sweepLoop([[0,0],[20,0]],()=>[...inward(),{a:[2,-4],b:[-2,-4],kind:1}],{closed:false,closeSection:false,capEnds:true});
 assert.ok(auditGeometry(legacy).inconsistentEdges>0,'positive control: inward walls disagree with outward end caps');
}
// A real tight Aurora seawall corner. A fixed diagonal exits this concave
// bottom-return quad, even after per-triangle winding correction.
{
 const loop=[[-1240,588.8279061140502],[-1235,585.9017478186543],[-1234.0861531782134,585],[-1242.6198418765257,570]];
 const profile=(x,z,k)=>{const s=k===2?.278809:1,p=[[2.4*s,-16],[0,2.3],[0,3.45],[-.7*s,3.45],[-.7*s,-16]];return p.slice(0,-1).map((a,i)=>({a,b:p[i+1],kind:1}));};
 const g=sweepLoop(loop,profile,{closed:false,closeSection:true,capEnds:true});
 const a=auditGeometry(g,{tolerance:1e-4});
 assert.equal(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges,0,'concave return remains closed and consistently triangulated');
 const old=g.clone(),ix=Array.from(g.index.array);
 for(let f=0;f<5;f++)for(let k=0;k<3;k++){const a=f*8+k*2,b=a+1,c=a+2,d=a+3;ix.splice(f*18+k*6,6,a,c,b,b,c,d);}
 old.setIndex(fixWinding(Array.from(g.attributes.position.array),Array.from(g.attributes.normal.array),ix));
 assert.ok(auditGeometry(old,{tolerance:1e-4}).inconsistentEdges>0,'positive control: fixed diagonal folds the actual concave return');
}
for (const definition of wardTowerDefs().filter(t => CROWN_BUILDERS[t.type])) for (const seed of [definition.seed,41,127]) {
 const g=CROWN_BUILDERS[definition.type](definition,mulberry32(seed)).geo, a=auditGeometry(g,{tolerance:1e-4});
 assert.equal(a.boundaryEdges+a.inconsistentEdges+a.nonFinite+a.invalidNormals+a.degenerates,0,`${definition.type}/${seed}: complete outward crown`);
 assert.ok(a.signedVolume>0,`${definition.type}/${seed}: positive solid volume`);
}
const transit=buildTransit(new THREE.Scene(),{metro:{wards:wardRecords().map(rec=>({rec}))},colliders:[],reflectionHide:[]},{audit:true});
const network=transit.meshes.find(m=>m.name==='Transit network');
const audit=auditGeometry(network.geometry,{tolerance:1e-3});
assert.equal(audit.boundaryEdges+audit.inconsistentEdges+audit.nonFinite+audit.invalidNormals+audit.degenerates,0,'all structural transit meshes have closed nondegenerate boundaries');
assert.equal(transit.nodes.size,15,'all seven wards, five island cities and three massif towns have stations');
for(const [i,g]of transit.auditParts.entries()){
 const a=auditGeometry(g,{tolerance:.001});
 assert.equal(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges+a.degenerates+a.nonFinite+a.invalidNormals,0,`actual transit component ${i} is closed and nondegenerate`);
 assert.ok(a.signedVolume>0,`actual transit component ${i} has outward material`);
}
// The generated receiving squares, station podiums and threshold stairs must
// agree in actual triangle space. The original independent centre survey buried
// the Ridgeholm station and left the other arrivals at different elevations.
const towns=buildMassifTowns(new THREE.Scene(),outerCities().massif,[],{audit:true});
const mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
const probe=g=>{const m=new THREE.Mesh(g,mat);m.updateMatrixWorld();return m;};
const netProbe=probe(network.geometry);let arrivalChecks=0,stepChecks=0,oldMismatch=0;
for(const gondola of transit.gondolas){
 const arrival=gondola.arrival,threshold=arrival.threshold;
 const squareParts=towns.auditParts.filter(p=>p.geometry.userData.islandMassifTerrace?.kind==='station square');
 const square=squareParts.map(p=>probe(p.geometry)).find(m=>{m.geometry.computeBoundingBox();return m.geometry.boundingBox.clone().expandByScalar(.005).containsPoint(new THREE.Vector3(gondola.top.x,arrival.level,gondola.top.z).addScaledVector(threshold.down,30));});
 assert.ok(square,`${gondola.id}: actual receiving square selected`);
 for(const offset of [-1.8,0,1.8]){
  const point=threshold.foot.clone().addScaledVector(threshold.down,.1).addScaledVector(threshold.across,offset);
  ray.set(point.clone().add(new THREE.Vector3(0,1,0)),down);ray.far=2;
  const hit=ray.intersectObject(square,false)[0];assert.ok(hit&&Math.abs(hit.point.y-arrival.level)<.005,'stair foot meets actual civic square');arrivalChecks++;
 }
 for(let k=0;k<threshold.count;k++)for(const offset of [-1.8,0,1.8]){
  const point=threshold.foot.clone().addScaledVector(threshold.down,-(k+.5)*threshold.tread).addScaledVector(threshold.across,offset);
  point.y=arrival.level+(k+1)*threshold.riser;
  ray.set(point.clone().add(new THREE.Vector3(0,2.2,0)),down);ray.far=2.3;
  const hit=ray.intersectObject(netProbe,false)[0];assert.ok(hit&&Math.abs(hit.point.y-point.y)<.015,`${gondola.id}: founded unobstructed threshold tread ${k}`);stepChecks++;
 }
 assert.ok(threshold.riser<=.18&&threshold.width>=4,'arrival has broad human-scale threshold steps');
 // The podium's uncovered uphill rim must clear real rendered terrain as well
 // as meet the same receiving level; a central height alone is insufficient.
 for(let i=0;i<40;i++){
  const a=i*Math.PI/20,x=gondola.top.x+Math.cos(a)*20.8,z=gondola.top.z+Math.sin(a)*20.8;
  assert.ok(arrival.level-renderedHeight(x,z)>.3,'complete station rim clears uphill terrain');arrivalChecks++;
 }
 const oldPodium=renderedHeight(gondola.top.x,gondola.top.z)-.2;
 if(arrival.level-oldPodium>2)oldMismatch++;
}
assert.equal(oldMismatch,3,'original independently surveyed station datum fails all three arrivals');
// Audit complete swept cabin volumes against generated town material near each
// receiving station. Five downward rays missed narrow side walls and overhangs;
// triangle contact plus containment covers the actual intervening space too.
const cableClearance=[];
for(const line of transit.gondolas){
 const town=outerCities().massif.find(m=>m.id===line.id);
 const transform=new THREE.Matrix4().set(line.side.x,0,line.side.z,-line.side.x*line.top.x-line.side.z*line.top.z,0,1,0,0,line.dir.x,0,line.dir.z,-line.dir.x*line.top.x-line.dir.z*line.top.z,0,0,0,1);
 const local=p=>p.clone().applyMatrix4(transform);
 const parts=towns.auditParts.filter(p=>{
  if(!p.name.startsWith(town.name))return false;
  p.geometry.computeBoundingBox();const b=p.geometry.boundingBox;
  return b.max.x>line.top.x-220&&b.min.x<line.top.x+220&&b.max.z>line.top.z-220&&b.min.z<line.top.z+220;
 }).flatMap(p=>solidComponents(p.geometry,transform).map(c=>({...c,name:p.name})));
 let sweeps=0,maxGrade=0,blockedControl=false;
 for(const path of [line.up,line.down])for(let k=1;k<path.length;k++){
  const a=path[k-1],b=path[k];maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z));
  if(b.distanceTo(line.top)>190)continue;
  const steps=Math.ceil(a.distanceTo(b));
  for(let j=0;j<steps;j++){
   const p=a.clone().lerp(b,j/steps),q=a.clone().lerp(b,(j+1)/steps);
   // The terminal's enclosed receiving hall is intentionally entered. Its
   // threshold and foundation are tested separately above.
   if(Math.min(Math.hypot(p.x-line.top.x,p.z-line.top.z),Math.hypot(q.x-line.top.x,q.z-line.top.z))<18)continue;
   const A=local(p),B=local(q),bounds=new THREE.Box3().setFromPoints([A,B]);
   bounds.min.add(new THREE.Vector3(-1.3,-7.4,-1.9));bounds.max.add(new THREE.Vector3(1.3,.3,1.9));
   const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
   const box=solidComponents(new THREE.BoxGeometry(size.x,size.y,size.z).translate(center.x,center.y,center.z))[0];
   const hits=parts.filter(c=>materialContact(box,c,.001));
   assert.deepEqual(hits.map(c=>c.name),[],`${line.id}: cabin swept volume clears actual town material at ${p.toArray()}`);sweeps++;
   if(!blockedControl){const obstacle=solidComponents(new THREE.BoxGeometry(.08,3,.08).translate(center.x+.9,center.y,center.z+.7))[0];blockedControl=materialContact(box,obstacle);}
  }
 }
 assert.ok(sweeps>250&&blockedControl,'A narrow misplaced post inside the moving cabin envelope is detected');
 assert.ok(maxGrade<.5,`${line.id}: raised approach retains a manageable cable grade`);
 cableClearance.push({town:line.id,sweptCabinSections:sweeps,actualTownSolids:parts.length,maxSegmentGrade:maxGrade});
}
console.log(JSON.stringify({arrivalChecks,stepChecks,oldMismatch}));
console.log(JSON.stringify({cableClearance}));
console.log('All crown families and fifteen-station network',JSON.stringify(audit));
console.log('PLATFORM_SOLIDS_OK');
