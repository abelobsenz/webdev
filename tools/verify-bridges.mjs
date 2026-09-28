import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildWardBridges } from '../src/world/bridges.js';
import { wardRecords, wardBridgePaths, wardHeight, wardTowerDefs, planWard } from '../src/world/metro.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { buildBuildings } from '../src/world/buildings.js';
import { frameAt } from '../src/world/infrastructure.js';
import { buildTerrainData, HeightSampler, terrainHeight } from '../src/world/terrain.js';
import { auditGeometry } from './geometry-audit.mjs';

const V=(x,y,z)=>new THREE.Vector3(x,y,z), errors=[],metrics=[];
const check=(ok,message)=>{if(!ok)errors.push(message);};
const sampler=new HeightSampler(await buildTerrainData());
const raw=(x,z)=>sampler.get(x,z),ground=(x,z)=>Math.max(0,raw(x,z),wardHeight(x,z));
const foundation=(x,z)=>Math.max(raw(x,z),wardHeight(x,z));
const scene=new THREE.Scene(),empty=buildWardBridges(scene,[],[],ground,{});
assert.equal(scene.children.length,0);
for(const key of ['meshes','lod','stations','lamps','decks','colliders','interfaces'])assert.deepEqual(empty[key],[],`empty bridge input: ${key}`);
const open=new THREE.BoxGeometry();open.setIndex(Array.from(open.index.array).slice(3));
assert.ok(auditGeometry(open).boundaryEdges>0,'missing-face control must fail closure');
assert.equal(auditGeometry(new THREE.BoxGeometry()).boundaryEdges,0);
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const ray=new THREE.Raycaster(),direction=V(.931,.277,.237).normalize(),point=new THREE.Vector3();
function prepare(part){part.geometry.computeBoundingBox();part.bounds=part.geometry.boundingBox;part.mesh=new THREE.Mesh(part.geometry,material);part.mesh.updateMatrixWorld();return part;}
const triangle=new THREE.Triangle(),closest=new THREE.Vector3();
function contact(p,radius,parts,skip=null){
  for(const part of parts){if(part===skip||part.bounds.distanceToPoint(p)>radius+.06)continue;
    if(part.bounds.containsPoint(p)){
      ray.set(p,direction);ray.near=1e-5;ray.far=Infinity;
      const hits=ray.intersectObject(part.mesh,false);let n=0,last=-Infinity;
      for(const hit of hits)if(hit.distance-last>1e-4){n++;last=hit.distance;}
      if(n%2===1)return true;
    }
    const g=part.geometry,pos=g.attributes.position,ix=g.index;
    for(let i=0;i<(ix?.count??pos.count);i+=3){triangle.a.fromBufferAttribute(pos,ix?ix.getX(i):i);triangle.b.fromBufferAttribute(pos,ix?ix.getX(i+1):i+1);triangle.c.fromBufferAttribute(pos,ix?ix.getX(i+2):i+2);triangle.closestPointToPoint(p,closest);if(closest.distanceToSquared(p)<(radius+.06)**2)return true;}
  }
  return false;
}
function materialDistance(p,geometries,cutoff=Infinity){
 let best=cutoff;
 for(const g of geometries){g.computeBoundingBox();if(g.boundingBox.distanceToPoint(p)>best)continue;const pos=g.attributes.position,ix=g.index;
  for(let i=0;i<(ix?.count??pos.count);i+=3){triangle.a.fromBufferAttribute(pos,ix?ix.getX(i):i);triangle.b.fromBufferAttribute(pos,ix?ix.getX(i+1):i+1);triangle.c.fromBufferAttribute(pos,ix?ix.getX(i+2):i+2);triangle.closestPointToPoint(p,closest);best=Math.min(best,closest.distanceTo(p));}
 }
 return best;
}
function edgesMeetMaterial(vertices,index,meshes){
 let edges=0;
 for(let i=0;i<index.count;i+=3)for(let k=0;k<3;k++){const a=vertices[index.getX(i+k)],b=vertices[index.getX(i+(k+1)%3)],v=b.clone().sub(a),length=v.length();if(length<1e-5)continue;ray.set(a,v.normalize());ray.near=.001;ray.far=length-.001;edges++;if(ray.intersectObjects(meshes,false).length)return{hit:true,edges};}
 // A complete small support wholly embedded in a wall would have no crossing
 // edges. Independently test its first material vertex for containment too.
 const p=vertices[0];ray.set(p,direction);ray.near=1e-5;ray.far=Infinity;
 for(const mesh of meshes){if(!mesh.geometry.boundingBox.containsPoint(p))continue;let n=0,last=-Infinity;for(const h of ray.intersectObject(mesh,false))if(h.distance-last>1e-4){n++;last=h.distance;}if(n%2===1)return{hit:true,edges};}
 return{hit:false,edges};
}
// Exact generated triangles are indexed independently for bounded vertical
// occupancy/support queries, avoiding a full-scene ray scan at every sample.
function surfaceIndex(parts){
 const cells=new Map(),size=80,triangles=[];
 for(const part of parts){const p=part.geometry.attributes.position,ix=part.geometry.index;for(let i=0;i<(ix?.count??p.count);i+=3){const ids=[0,1,2].map(k=>ix?ix.getX(i+k):i+k),q=ids.map(j=>V(p.getX(j),p.getY(j),p.getZ(j))),record={q,part},xs=q.map(v=>v.x),zs=q.map(v=>v.z);const index=triangles.push(record)-1;for(let u=Math.floor(Math.min(...xs)/size);u<=Math.floor(Math.max(...xs)/size);u++)for(let v=Math.floor(Math.min(...zs)/size);v<=Math.floor(Math.max(...zs)/size);v++){const key=`${u},${v}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(index);}}}
 const cast=new THREE.Ray(),hit=new THREE.Vector3();
 return (x,z,top,bottom)=>{cast.set(V(x,top,z),V(0,-1,0));let y=-Infinity;for(const i of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[]){const {q}=triangles[i];if(cast.intersectTriangle(...q,false,hit)&&hit.y>=bottom)y=Math.max(y,hit.y);}return y;};
}
const probe=prepare({geometry:new THREE.BoxGeometry(4,4,4)});
assert.ok(contact(V(0,0,0),.1,[probe]),'contact positive control is inside actual solid');
assert.ok(!contact(V(0,8,0),.1,[probe]),'detached contact control');
assert.equal(surfaceIndex([probe])(0,0,5,-5),2,'occupancy control finds blocking top');
assert.equal(surfaceIndex([probe])(8,0,5,-5),-Infinity,'clear passage control');
const embedded=new THREE.BoxGeometry(1,1,1),embeddedVertices=[];for(let i=0;i<embedded.attributes.position.count;i++)embeddedVertices.push(V().fromBufferAttribute(embedded.attributes.position,i));
assert.ok(edgesMeetMaterial(embeddedVertices,embedded.index,[probe.mesh]).hit,'wholly embedded material is detected even when no edges cross');embedded.dispose();

// Independent material intersection: both edge directions are needed when a
// broad deck face cuts a narrow wall. Two point-in-solid tests also catch a
// complete object enclosed by another solid without crossing boundary edges.
function insideMaterial(point, meshes) {
 for(const mesh of meshes){
  mesh.geometry.computeBoundingBox();if(!mesh.geometry.boundingBox.containsPoint(point))continue;
  ray.set(point,direction);ray.near=1e-5;ray.far=Infinity;let n=0,last=-Infinity;
  for(const hit of ray.intersectObject(mesh,false))if(hit.distance-last>1e-4){n++;last=hit.distance;}
  if(n%2)return true;
 }
 return false;
}
function materialIntersection(a,b){
 const vertices=g=>Array.from({length:g.attributes.position.count},(_,i)=>V().fromBufferAttribute(g.attributes.position,i));
 for(const [left,right]of [[a,b],[b,a]])for(const mesh of left){
  const verts=vertices(mesh.geometry);if(edgesMeetMaterial(verts,mesh.geometry.index,right).hit)return true;
  if(insideMaterial(verts[0],right))return true;
 }
 return false;
}
function verifyTownContacts(parts, plans){
 let candidates=0,volumePairs=0,controls=0;const collisions=[];
 const create=g=>{const m=new THREE.Mesh(g,material);m.updateMatrixWorld();g.computeBoundingBox();return m;};
 const controlA=create(new THREE.BoxGeometry(8,8,8)),controlB=create(new THREE.BoxGeometry(2,2,2));
 assert.ok(materialIntersection([controlA],[controlB]),'contained solid is detected without intersecting triangle edges');controls++;
 assert.ok(materialIntersection([controlB],[controlA]),'inverse enclosed solid is detected');controls++;
 controlB.geometry.translate(3.5,0,0);assert.ok(materialIntersection([controlA],[controlB]),'crossing faces are detected');controls++;
 controlA.geometry.dispose();controlB.geometry.dispose();
 for(const {rec,P}of plans)for(const L of P.lots){
  const wx=rec.w.x+L.lx,wz=rec.w.z+L.lz,reach=Math.hypot(L.w,L.d)*.5+5;
  const nearby=parts.filter(p=>p.bounds.min.x<wx+reach&&p.bounds.max.x>wx-reach&&p.bounds.min.z<wz+reach&&p.bounds.max.z>wz-reach);
  if(!nearby.length)continue;candidates++;
  const town=buildBuildings(new THREE.Scene(),{lots:[{...L,x:0,z:0,rot:0,lo:0,hi:0,dk:'ward',district:rec.w.id}],districts:[{id:rec.w.id,kind:'ward',x:0,z:0}]},()=>0,{lowrise:1});
  const bounds=new THREE.Box3();for(const m of town.meshes){m.material=material;m.updateMatrixWorld();m.geometry.computeBoundingBox();bounds.union(m.geometry.boundingBox);}
  const c=Math.cos(L.rot),sn=Math.sin(L.rot),matrix=new THREE.Matrix4().makeRotationY(-L.rot);matrix.setPosition(-wx*c+wz*sn,-L.y,-wx*sn-wz*c);
  for(const part of nearby){
   const g=part.geometry.clone().applyMatrix4(matrix);g.computeBoundingBox();
   if(g.boundingBox.intersectsBox(bounds)){
    volumePairs++;const mesh=create(g);
    if(materialIntersection([mesh],town.meshes))collisions.push({ward:rec.w.id,bridge:part.ward,kind:part.kind,seed:L.seed,x:L.lx,z:L.lz});
   }
   g.dispose();
  }
  for(const m of town.meshes)m.geometry.dispose();
 }
 return{candidates,volumePairs,collisions,controls};
}
const townTowers=buildTowers(wardTowerDefs(),ground,new THREE.Scene());for(const t of townTowers)t.footprint=towerFootprint(t,100);
const townPlans=wardRecords().map(rec=>({rec,P:planWard(rec,townTowers)}));
// Survey the complete seaward ray independently of the landing planner. The
// historical first-water endpoint fails this test at all Tidewater canals.
for(const rec of wardRecords())for(const L of rec.landings){
 const radius=Math.hypot(...L.E),dx=Math.cos(L.b),dz=Math.sin(L.b);let outside=true;
 for(let r=radius+2;r<rec.R(L.b)*1.25;r+=1)if(rec.levels[0].grid.sample(dx*r,dz*r)<-1)outside=false;
 check(outside,`${rec.w.id}/${L.kind}: no inhabited land beyond a sea-bridge endpoint`);
 if(rec.w.id==='tidewater'){
  let old=rec.R(L.b)*.5;while(old<rec.R(L.b)*1.2&&rec.levels[0].grid.sample(dx*old,dz*old)<0)old+=.5;
  assert.ok(radius-old>300,'historical first-canal landing is rejected by the coast survey');
 }
}

for(const bp of wardBridgePaths(ground)){
 const parts=[];const built=buildWardBridges(new THREE.Scene(),[bp],wardRecords(),ground,{}, {onComponent:p=>parts.push(p)});
 const id=bp.ward,interfaceData=built.interfaces[0];let triangles=0,endpoints=0,foundingContacts=0,foundationSamples=0,passageSamples=0,stairSamples=0;
 for(const [i,p]of parts.entries()){
  prepare(p);const a=auditGeometry(p.geometry,{tolerance:1e-4});triangles+=a.triangles;
  check(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges+a.nonFinite+a.invalidNormals===0,`${id}/${p.kind}/${i}: invalid material ${JSON.stringify(a)}`);
  check(a.signedVolume>0,`${id}/${p.kind}/${i}: outward volume`);
  const height=p.bounds.max.y-p.bounds.min.y;
  const founded=!p.geometry.userData.bridgeEnds&&((p.kind==='support'&&height>10)||(p.kind==='maglev-support'&&height>4)||(p.kind==='structure'&&height>25&&p.bounds.min.y<0));
  if(founded){const vertices=p.geometry.attributes.position;for(let j=0;j<vertices.count;j++)if(vertices.getY(j)<p.bounds.min.y+.1){const x=vertices.getX(j),y=vertices.getY(j),z=vertices.getZ(j);foundationSamples++;check(y<=foundation(x,z)+.1,`${id}/${p.kind}/${i}: caisson bottom is above actual founding surface`);}}
 }
 const openedDeck=parts.find(p=>p.kind==='deck').geometry.clone();openedDeck.setIndex(Array.from(openedDeck.index.array).slice(3));
 assert.ok(auditGeometry(openedDeck,{tolerance:1e-4}).boundaryEdges>0,`${id}: actual deck missing-face control`);openedDeck.dispose();
 if(id==='coral'){
  const branches=parts.filter(p=>p.kind==='support'&&p.geometry.userData.bridgeEnds);
  check(branches.length>30&&branches.length%3===0,'coral: three material branches at every coral crown');
  for(const p of branches)check(p.bounds.min.y>-20,'coral: visible branching crown must not descend into the deep seabed');
  const submerged=branches[0].geometry.clone().translate(0,-80,0);submerged.computeBoundingBox();
  assert.ok(submerged.boundingBox.min.y<=-20,'coral: submerged crown silhouette regression control');submerged.dispose();
 }
 const caisson=parts.find(p=>p.kind==='support'&&!p.geometry.userData.bridgeEnds&&p.bounds.max.y-p.bounds.min.y>10)||parts.find(p=>p.kind==='maglev-support'&&!p.geometry.userData.bridgeEnds);
 const detached=caisson.geometry.clone().translate(0,600,0);detached.computeBoundingBox();const dc=detached.boundingBox.getCenter(new THREE.Vector3());
 assert.ok(detached.boundingBox.min.y>foundation(dc.x,dc.z)+1,`${id}: displaced actual caisson fails founding control`);detached.dispose();
 for(const [i,p]of parts.entries()){
  const ends=p.geometry.userData.bridgeEnds;if(!ends)continue;
  const founded=ends.some(e=>e.point[1]-e.radius<=foundation(e.point[0],e.point[2])+.1);
  for(const [j,e]of ends.entries()){
   point.fromArray(e.point);const soil=point.y-e.radius<=foundation(point.x,point.z)+.1;
   if(soil){foundingContacts++;continue;}
   if(founded)continue; // exposed cap of a post founded in terrain is intentional
   endpoints++;
   check(contact(point,e.radius,parts,p),`${id}/${p.kind}/${i}: detached endpoint ${j} ${e.point}`);
  }
 }
 const floor=surfaceIndex(parts);
 const blockedAt=bp.path[Math.floor(bp.path.length/2)],blocking=prepare({geometry:new THREE.BoxGeometry(4,3,4).translate(blockedAt.x,blockedAt.y+1.7,blockedAt.z)});
 assert.ok(surfaceIndex([blocking])(blockedAt.x,blockedAt.z,blockedAt.y+5,blockedAt.y)>blockedAt.y+1,`${id}: actual route obstruction control`);blocking.geometry.dispose();
 // Three walk lines span the actual 16 m clear corridor between its hedges.
 for(let k=2;k<bp.path.length-2;k++){
  const p=bp.path[k],f=frameAt(bp.path,k);
  for(const lateral of [-8,0,8]){const q=p.clone().addScaledVector(f.side,lateral),y=floor(q.x,q.z,p.y+2.1,p.y-.5);passageSamples++;check(Number.isFinite(y)&&Math.abs(y-(p.y+.2))<.35,`${id}: deck corridor obstruction/gap at ${k}/${lateral}, y=${y}, deck=${p.y}`);}
 }
 for(const arrival of interfaceData.arrivals){
  const a=V(...arrival.deck),b=V(...arrival.ground);
  for(let k=0;k<=24;k++){const p=a.clone().lerp(b,k===24?.999:k/24),y=floor(p.x,p.z,p.y+1.6,p.y-.4);passageSamples++;check(Number.isFinite(y)&&Math.abs(y-p.y)<.2,`${id}: arrival is supported and traversable at ${k}`);}
 }
 if(bp.head){const s=interfaceData.head.stairs,a=s.top,b=s.foot;
  check(s.rise>0&&s.rise<=.31,`${id}: reasonable stair rise`);
  for(let k=0;k<=s.steps*2;k++){const p=a.clone().lerp(b,k/(s.steps*2)),y=floor(p.x,p.z,bp.head.y+2,raw(p.x,p.z)-1);stairSamples++;check(Number.isFinite(y)&&y>=raw(p.x,p.z)-.05&&Math.abs(y-p.y)<.4,`${id}: stair walking connection ${k}, y=${y}, expected=${p.y}`);}
  const footY=floor(b.x,b.z,b.y+2,b.y-.5);check(Math.abs(footY-ground(b.x,b.z))<.2,`${id}: final stair tread reaches actual terrain`);
  check(Math.abs((footY+3)-ground(b.x,b.z))>.2,`${id}: raised stair broken control detected`);
 }
 // Locate the real terminal portal ring (the penultimate terminal component),
 // then measure the actual tube's vertices against it and ray into the shell.
 const rail=parts.find(p=>p.kind==='maglev').geometry,pos=rail.attributes.position;
 for(const e of interfaceData.stations){
  const station=parts.filter(p=>p.kind===`station-${e.end}`),ring=station.at(-2),rp=ring.geometry.attributes.position,unique=new Map();
  // A rotated finite polygon's AABB centre is biased by centimetres; weld its
  // actual periodic samples and average the symmetric material instead.
  for(let i=0;i<rp.count;i++){const q=V(rp.getX(i),rp.getY(i),rp.getZ(i));unique.set(q.toArray().map(v=>Math.round(v*1000)).join(','),q);}
  const centre=V(0,0,0);for(const q of unique.values())centre.addScaledVector(q,1/unique.size);let distance=Infinity;
  for(let i=0;i<pos.count;i++){point.fromBufferAttribute(pos,i);distance=Math.min(distance,point.distanceTo(centre));}
  check(distance<.01,`${id}/${e.end}: rail end meets actual portal centre (${distance})`);
  const t=V(Math.cos(e.rot),0,Math.sin(e.rot));
  for(const lateral of [-1.5,0,1.5]){const origin=centre.clone().addScaledVector(t,-2).add(V(-t.z*lateral,0,t.x*lateral));ray.set(origin,t);ray.near=0;ray.far=20;check(!ray.intersectObjects(station.map(p=>p.mesh),false).length,`${id}/${e.end}: usable terminal mouth`);}
 }
 const bracket=parts.find(p=>p.kind==='maglev-support'&&p.geometry.userData.bridgeEnds);
 if(bracket){const e=bracket.geometry.userData.bridgeEnds.at(-1),p=V(...e.point).add(V(0,40,0));check(!contact(p,e.radius,parts,bracket),`${id}: detached bracket broken control`);}
 const townContacts = verifyTownContacts(parts, townPlans);
 check(!townContacts.collisions.length,`${id}: bridge materials intersect actual buildings ${JSON.stringify(townContacts.collisions)}`);
 check(townContacts.controls===3,`${id}: crossing and both enclosure controls executed`);

 metrics.push({id,components:parts.length,triangles,endpoints,foundingContacts,foundationSamples,passageSamples,stairSamples,townContacts});
 for(const p of parts)p.geometry.dispose();for(const m of built.meshes){m.geometry.dispose();m.material.dispose();}
}
console.log(JSON.stringify(metrics,null,2));
assert.deepEqual(errors,[],'bridge defects');
console.log('BRIDGES_VERIFIED');
