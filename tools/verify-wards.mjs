import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wardRecords, wardTowerDefs, wardHeight, levelAtRec, planWard, wardSurfaceAt, buildWardPlatform, wardMooringGeometry, wardPlatformBox, wardTerraceSolids } from '../src/world/metro.js';
import { buildWardPlan } from '../src/world/wardPlan.js';
import { buildWardLandmarks, shipHullGeometry, closedWardSurface } from '../src/world/wardLandmarks.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { buildBuildings } from '../src/world/buildings.js';
import { buildStreetscape } from '../src/world/streetscape.js';
import { wardTreePathClear } from '../src/world/treePlanner.js';
import { terrainHeight } from '../src/world/terrain.js';
import { mulberry32 } from '../src/world/noise.js';
import { auditGeometry } from './geometry-audit.mjs';

// These independent geometric checks intentionally exercise the real production
// builders. Open controls prove that topology detection does not merely count meshes.
const check = (ok, message) => { if (!ok) issues.push(message); };
const issues = [], metrics = [];
assert.equal(auditGeometry(new THREE.CylinderGeometry(2, 2, 5, 12, 1, true)).boundaryEdges, 24);
assert.equal(auditGeometry(new THREE.BoxGeometry()).boundaryEdges, 0);
function solid(name, g, composite = false) {
  const a = auditGeometry(g, { tolerance: 1e-4 });
  check(!a.boundaryEdges, `${name}: ${a.boundaryEdges} open edges`);
  check(!a.inconsistentEdges, `${name}: ${a.inconsistentEdges} reversed seams`);
  check(!a.nonFinite && !a.invalidNormals, `${name}: invalid attributes`);
  if (!composite) check(!a.nonManifoldEdges && a.signedVolume > 0, `${name}: manifold outward material`);
  return a;
}
for (const big of [false, true]) solid(`closed ship ${big}`, shipHullGeometry(big ? 170 : 45, big ? 22 : 9, big));
solid('curved material shell', closedWardSurface(10, 8, (u,v) => new THREE.Vector3(u * 12, Math.sin(u * 2) * v * 3, v * 9), .4));
const fixtures = buildWardPlan({w:{id:'fixture'},half:80,rnd:mulberry32(123),levelAt:()=>9}, {plan:()=>({streets:[],squares:[{x:0,z:0,r:30}],sites:[{x:0,z:0,r:12}],lots:[]})});
const reserveAt = (P,x,z) => P.reserve[Math.floor((z+P.half)/P.field.cell)*P.field.N+Math.floor((x+P.half)/P.field.cell)];
assert.equal(reserveAt(fixtures,0,0),2,'landmark reservation survives overlapping plaza');
assert.equal(reserveAt(fixtures,20,0),3,'control plaza is still a plaza');
const clippedFixture = blocked => buildWardPlan({w:{id:'clipped-fixture'},half:90,rnd:mulberry32(124),blocked:(x)=>blocked&&x>=-16&&x<=-8,levelAt:(x)=>x>-8&&x<28&&!(x>=0&&x<=4)?null:9}, {plan:()=>({streets:[{pts:[[-60,0],[60,0]],hw:2,cls:2}],lots:[],squares:[]})});
assert.equal(clippedFixture(true).bridges.length,0,'discarded short street run preserves solid obstruction');
assert.equal(clippedFixture(false).bridges.length,1,'control water gap still receives a bridge');
const boxParts=[];
wardPlatformBox(boxParts,[0,0],[1,0],[0,1],-2,2,-1,1,0,5,1,0,0);
solid('platform framed box including underside',boxParts[0]);
solid('complete mooring assembly',wardMooringGeometry(),true);
// A single long contour segment must not hide an entrance between its vertices.
const terraceFixture=wardTerraceSolids([[-30,0],[30,0],[30,30],[-30,30]],3,9,1,[{x:0,z:0,hw:3}],0,0);
const terraceMeshes=terraceFixture.map(g=>new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
for(const [i,g]of terraceFixture.entries())solid(`terrace passage component ${i}`,g);
for(const x of [-2,0,2])assert.equal(new THREE.Raycaster(new THREE.Vector3(x,9.6,-3),new THREE.Vector3(0,0,1),0,6).intersectObjects(terraceMeshes,false).length,0,'terrace glazing leaves a real 4 m opening');
assert.ok(new THREE.Raycaster(new THREE.Vector3(10,9.6,-3),new THREE.Vector3(0,0,1),0,6).intersectObjects(terraceMeshes,false).length,'control ray meets terrace balustrade');

const pathControl = (x,z) => Math.abs(z)<2 && x>-10 && x<10 ? 'path' : 'lawn';
assert.ok(!wardTreePathClear(pathControl,0,0),'tree centred on public path rejected');
assert.ok(!wardTreePathClear(pathControl,0,2.5),'root flare at path edge rejected');
assert.ok(wardTreePathClear(pathControl,0,8),'off-path tree control retained');

const towers = buildTowers(wardTowerDefs(), (x,z)=>Math.max(wardHeight(x,z),terrainHeight(x,z)), new THREE.Scene());
for (const t of towers) t.footprint = towerFootprint(t,100);
const pointSegment = (p,a,b) => {const x=b[0]-a[0],z=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*z);};
function corners(L,pad=.6) {const c=Math.cos(L.rot),s=Math.sin(L.rot);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{const x=u*(L.w/2+pad),z=v*(L.d/2+pad);return [(L.lx??L.x)+x*c+z*s,(L.lz??L.z)-x*s+z*c];});}
function overlap(A,B) {for(const poly of [A,B])for(let k=0;k<2;k++){const p=poly[k],q=poly[k+1],nx=q[1]-p[1],nz=p[0]-q[0];const pa=A.map(p=>p[0]*nx+p[1]*nz),pb=B.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...pa)<=Math.min(...pb)+1e-5||Math.max(...pb)<=Math.min(...pa)+1e-5)return false;}return true;}
assert.ok(overlap(corners({x:0,z:0,w:10,d:10,rot:0}),corners({x:5,z:0,w:10,d:10,rot:0})));
assert.ok(!overlap(corners({x:0,z:0,w:10,d:10,rot:0}),corners({x:15,z:0,w:10,d:10,rot:0})));
function generatedEnvelope(L,id,visit) {
  const lot={...L,x:0,z:0,rot:0,lo:0,hi:0,dk:'ward',district:id};
  const out=buildBuildings(new THREE.Scene(),{lots:[lot],districts:[{id,kind:'ward',x:0,z:0}]},()=>0,{lowrise:1});
  if(visit)visit(out.meshes);
  const bounds=new THREE.Box3();
  for(const mesh of out.meshes){mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox);mesh.geometry.dispose();mesh.material.dispose();}
  assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite),'actual generated building bounds finite');
  const c=Math.cos(L.rot),s=Math.sin(L.rot),world=(x,z)=>[L.lx+x*c+z*s,L.lz-x*s+z*c];
  return {poly:[[bounds.min.x,bounds.min.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z],[bounds.min.x,bounds.max.z]].map(p=>world(...p)),bounds,world};
}
// Triangles from production meshes, indexed independently of the planning SDF.
// Vertical support and walking-segment obstruction both query these real faces.
function faceIndex(geometries) {
  const cells=new Map(),size=24,triangle=new THREE.Triangle(),normal=new THREE.Vector3(),ray=new THREE.Ray(),hit=new THREE.Vector3();
  let triangles=0;
  for(const geometry of geometries){const p=geometry.attributes.position,ix=geometry.index;if(!p)continue;for(let k=0;k<(ix?.count??p.count);k+=3){
    const q=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,ix?ix.getX(k+j):k+j));triangle.set(...q);triangle.getNormal(normal);
    const xs=q.map(v=>v.x),zs=q.map(v=>v.z),face={q,up:normal.y>.5};triangles++;
    for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let z=Math.floor(Math.min(...zs)/size);z<=Math.floor(Math.max(...zs)/size);z++){const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(face);}
  }}
  const near=(x,z)=>cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[];
  return{triangles,floor(x,z,top,bottom){ray.set(new THREE.Vector3(x,top,z),new THREE.Vector3(0,-1,0));let y=-Infinity;for(const f of near(x,z))if(f.up&&ray.intersectTriangle(...f.q,false,hit)&&hit.y>=bottom)y=Math.max(y,hit.y);return y;},
    blocked(a,b){const d=b.clone().sub(a),length=d.length();if(length<1e-6)return false;ray.set(a,d.normalize());const candidates=new Set([...near(a.x,a.z),...near(b.x,b.z)]);for(const f of candidates)if(ray.intersectTriangle(...f.q,false,hit)&&hit.distanceTo(a)>.001&&hit.distanceTo(a)<length-.001)return true;return false;}};
}
function walkGeometry(index, route, label) {
  let samples=0,missing=0,steps=0,blocked=0,previous=null;
  for(let k=1;k<route.pts.length;k++){
    const a=route.pts[k-1],b=route.pts[k],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(length/.12));
    for(const side of [-1,0,1]){previous=null;for(let j=0;j<=n;j++){
      const x=a[0]+dx*j/n-dz/(length||1)*route.halfWidth*side,z=a[1]+dz*j/n+dx/(length||1)*route.halfWidth*side;
      const floor=index.floor(x,z,route.maxY??route.y+1,route.minY??route.y-.2);samples++;
      if(!Number.isFinite(floor)){missing++;if(process.env.WARD_DEBUG&&missing<4)console.log('MISSING',label,x,z);previous=null;continue;}
      if(previous){if(Math.abs(floor-previous.y)>.36){steps++;if(process.env.WARD_DEBUG&&steps<7)console.log('RISER',label,previous,{x,y:floor,z});}for(const head of [.4,1.8])if(index.blocked(new THREE.Vector3(previous.x,previous.y+head,previous.z),new THREE.Vector3(x,floor+head,z)))blocked++;}
      previous={x,y:floor,z};
    }}
  }
  check(!missing&&!steps&&!blocked,`${label}: actual public floor missing=${missing}, high risers=${steps}, barriers=${blocked}`);
  return{samples,missing,steps,blocked};
}
const floorControl=new THREE.BoxGeometry(10,.2,10).translate(0,-.1,0),barrierControl=new THREE.BoxGeometry(1,3,3).translate(0,1.5,0);
assert.ok(Math.abs(faceIndex([floorControl]).floor(0,0,2,-1))<1e-6,'actual paving control');
assert.equal(faceIndex([]).floor(0,0,2,-1),-Infinity,'missing paving control');
assert.ok(faceIndex([barrierControl]).blocked(new THREE.Vector3(-2,1,0),new THREE.Vector3(2,1,0)),'wall-through-route control');
floorControl.dispose();barrierControl.dispose();

const collisionMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),collisionRay=new THREE.Raycaster(),collisionDirection=new THREE.Vector3(.932,.277,.237).normalize();
function meshFor(g){const m=new THREE.Mesh(g,collisionMaterial);g.computeBoundingBox();m.updateMatrixWorld();return m;}
function solidsMeet(a,b){
 for(const [left,right]of [[a,b],[b,a]])for(const m of left){
  const p=m.geometry.attributes.position,ix=m.geometry.index,first=new THREE.Vector3().fromBufferAttribute(p,0);
  for(const other of right){other.geometry.computeBoundingBox();if(other.geometry.boundingBox.containsPoint(first)){collisionRay.set(first,collisionDirection);collisionRay.near=1e-5;collisionRay.far=Infinity;let n=0,last=-Infinity;for(const h of collisionRay.intersectObject(other,false))if(h.distance-last>1e-4){last=h.distance;n++;}if(n%2)return true;}}
  for(let k=0;k<ix.count;k+=3)for(let j=0;j<3;j++){const a=new THREE.Vector3().fromBufferAttribute(p,ix.getX(k+j)),b=new THREE.Vector3().fromBufferAttribute(p,ix.getX(k+(j+1)%3)),d=b.sub(a),length=d.length();if(length<1e-5)continue;collisionRay.set(a,d.normalize());collisionRay.near=.001;collisionRay.far=length-.001;if(collisionRay.intersectObjects(right,false).length)return true;}
 }
 return false;
}
{
 const box=meshFor(new THREE.BoxGeometry(8,8,8)),inside=meshFor(new THREE.BoxGeometry(2,2,2));
 assert.ok(solidsMeet([box],[inside])&&solidsMeet([inside],[box]),'both full containment controls detected');
 inside.geometry.translate(3.5,0,0);assert.ok(solidsMeet([box],[inside]),'crossing material control');inside.geometry.translate(20,0,0);assert.ok(!solidsMeet([box],[inside]),'separated material control');box.geometry.dispose();inside.geometry.dispose();
}

for (const rec of wardRecords().filter(r=>!process.env.WARD_ID||r.w.id===process.env.WARD_ID)) {
  const id=rec.w.id,P=planWard(rec,towers); rec.plan=P;
  const repeat=planWard(rec,towers);
  let treePathSamples=0;
  const surface=(x,z)=>wardSurfaceAt(rec,P,x,z);
  for(const route of P.accessRoutes)for(let i=1;i<route.pts.length;i++){
    const a=route.pts[i-1],b=route.pts[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3);
    for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(surface(x,z)==='path'){treePathSamples++;assert.ok(!wardTreePathClear(surface,x,z),`${id}: tree rejected on actual authored approach`);}}
  }

  assert.equal(JSON.stringify(P.lots),JSON.stringify(repeat.lots),`${id}: deterministic parcel plan`);
  const court=P.landmarks.find(L=>L.type==='wardCourt');
  check(!!court,`${id}: civic institution retained`);
  if(court){
    for(let i=0;i<72;i++){const a=i/72*Math.PI*2;check(levelAtRec(rec,court.x+Math.cos(a)*(court.r+1),court.z+Math.sin(a)*(court.r+1),.2)===court.y,`${id}: court footprint founded`);}
    const gate=P.extras.civicCourt.gate;
    const distance=Math.min(...P.streets.flatMap(st=>st.pts.slice(1).map((p,i)=>pointSegment(gate,st.pts[i],p)-st.hw)));
    check(distance<1,`${id}: entrance walk reaches actual clipped street (${distance.toFixed(2)}m)`);
    check(reserveAt(P,court.x,court.z)===2,`${id}: civic court reservation`);
  }
  let roadEdges=0,roadObstacles=0,lotPairs=0,lampSites=0,groundSamples=0;
  for(const st of P.streets)for(let i=0;i<st.pts.length;i++){
    const p=st.pts[i],a=st.pts[Math.max(0,i-1)],b=st.pts[Math.min(st.pts.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    for(const side of [-1,1]){groundSamples++;if(levelAtRec(rec,p[0]-dz/len*st.hw*side,p[1]+dx/len*st.hw*side,0)!==st.y)roadEdges++;}
    if(P.obstacles.some(o=>o.prim.d(...p)<st.hw+o.margin-1e-6))roadObstacles++;
  }
  check(!roadEdges,`${id}: ${roadEdges} road edges unsupported`);
  check(!roadObstacles,`${id}: ${roadObstacles} road samples intrude on civic/water plots`);
  const grid=new Map(),size=100,reach=Math.ceil((Math.max(...P.lots.map(L=>Math.hypot(L.w+1.2,L.d+1.2)))+24)/size);
  for(const L of P.lots){const i=Math.floor(L.lx/size),j=Math.floor(L.lz/size),A=corners(L);assert.ok(A.flat().every(Number.isFinite));for(let u=i-reach;u<=i+reach;u++)for(let v=j-reach;v<=j+reach;v++)for(const M of grid.get(`${u},${v}`)||[])if(overlap(A,corners(M)))lotPairs++;const key=`${i},${j}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(L);}
  check(!lotPairs,`${id}: ${lotPairs} overlapping actual podiums`);
  for(const L of P.lamps)if(reserveAt(P,L.lx,L.lz)===2||P.pools.some(p=>p.prim.d(L.lx,L.lz)<0))lampSites++;
  check(!lampSites,`${id}: ${lampSites} lamps inside civic/water reservations`);
  for(const pool of P.pools){const b=pool.prim.bbox;let n=0;for(let i=1;i<6;i++)for(let j=1;j<6;j++){const x=b[0]+(b[2]-b[0])*i/6,z=b[1]+(b[3]-b[1])*j/6;if(pool.prim.d(x,z)<-1&&levelAtRec(rec,x,z)!==null){n++;check(wardSurfaceAt(rec,P,x,z)==='water',`${id}: ornamental pool is CPU water`);}}check(n>0,`${id}: pool query exercised`);}
  if(id==='aurora')check(P.lots.filter(L=>L.civic&&L.type==='college').length===8,'all eight Academy colleges survive');
  if(id==='westmere')check(P.lots.filter(L=>L.civic&&L.type==='museum').length===10,'all ten Museum Mile museums survive');
  // Local ward coordinates avoid irrelevant large-world Float32 noise. Both LODs
  // and every authored building are measured individually, including their shells.
  let actualPairs=0,actualStreetIntrusions=0,minimumStreetFieldClearance=Infinity;
  const actualGrid=new Map(),roadGrid=new Map();
  for(const st of P.streets)for(let k=1;k<st.pts.length;k++){
    const a=st.pts[k-1],b=st.pts[k],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1e-8)continue;
    const nx=-dz/len*st.hw,nz=dx/len*st.hw,poly=[[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],key=`${Math.floor((a[0]+b[0])*.5/size)},${Math.floor((a[1]+b[1])*.5/size)}`;
    if(!roadGrid.has(key))roadGrid.set(key,[]);roadGrid.get(key).push(poly);
  }
  const platform=buildWardPlatform({...rec,w:{...rec.w,x:0,z:0}},P);
  const connectorParts=platform.connectors.flatMap((c,i)=>[...c.near,...c.far].map(geometry=>({geometry,label:`${c.kind}/${i}`})));
  const bridgeMeshes=[];
  for(const [i,br]of P.bridges.entries()){
    const r={...rec,w:{...rec.w,x:0,z:0},ctx:{...rec.ctx,features:{lighthouses:[],docks:[],basins:[]}}};
    const made=buildWardLandmarks(new THREE.Scene(),r,{...P,landmarks:[],pools:[],bridges:[br]},{topLoops:[]},{palette:rec.design.palette});
    for(const mesh of made.meshes){bridgeMeshes.push(mesh);connectorParts.push({geometry:mesh.geometry,label:`canal-bridge/${i}/${mesh.name}`});}
  }
  for(const part of connectorParts){part.geometry.computeBoundingBox();part.bounds=part.geometry.boundingBox;}
  let connectorBuildingPairs=0,connectorCollisions=0,actualBuildingLODs=0;
  const routeHouseNear=[],routeHouseFar=[];
  const inspectActual=(L,meshes)=>{
    actualBuildingLODs+=meshes.length;
    const bounds=new THREE.Box3();for(const m of meshes){m.geometry.computeBoundingBox();bounds.union(m.geometry.boundingBox);m.material=collisionMaterial;m.updateMatrixWorld();}
    const c=Math.cos(L.rot),sn=Math.sin(L.rot),radius=Math.hypot(L.w,L.d)*.5+6,matrix=new THREE.Matrix4().makeRotationY(-L.rot);matrix.setPosition(-L.lx*c+L.lz*sn,-L.y,-L.lx*sn-L.lz*c);
    for(const part of connectorParts){if(part.bounds.min.x>L.lx+radius||part.bounds.max.x<L.lx-radius||part.bounds.min.z>L.lz+radius||part.bounds.max.z<L.lz-radius)continue;
      const g=part.geometry.clone().applyMatrix4(matrix);g.computeBoundingBox();if(g.boundingBox.intersectsBox(bounds)){connectorBuildingPairs++;if(solidsMeet([meshFor(g)],meshes)){connectorCollisions++;if(connectorCollisions<8)console.log('CONNECTOR_CONTACT',id,part.label,L.type,L.seed,L.lx,L.lz);}}g.dispose();
    }
    if(P.accessRoutes.some(r=>r.pts.slice(1).some((b,i)=>pointSegment([L.lx,L.lz],r.pts[i],b)<radius+15))){
      const toWard=new THREE.Matrix4().makeRotationY(L.rot);toWard.setPosition(L.lx,L.y,L.lz);
      for(const [i,m]of meshes.entries())(i%2?routeHouseFar:routeHouseNear).push(m.geometry.clone().applyMatrix4(toWard));
    }
  };
  let actualRoadPairs=0,actualSupportFailures=0,actualSiteIntrusions=0;
  for(const L of P.lots){const env=generatedEnvelope(L,id,meshes=>inspectActual(L,meshes)),i=Math.floor(L.lx/size),j=Math.floor(L.lz/size);for(let u=i-reach;u<=i+reach;u++)for(let v=j-reach;v<=j+reach;v++)for(const M of actualGrid.get(`${u},${v}`)||[])if(overlap(env.poly,M.poly)){actualPairs++; if(actualPairs<5)console.log('ACTUAL_PAIR',id,L.type,L.lx,L.lz,M.type,M.x,M.z);}
    for(let u=i-reach;u<=i+reach;u++)for(let v=j-reach;v<=j+reach;v++)for(const road of roadGrid.get(`${u},${v}`)||[])if(overlap(env.poly,road))actualRoadPairs++;
    const key=`${i},${j}`;if(!actualGrid.has(key))actualGrid.set(key,[]);actualGrid.get(key).push({...env,type:L.type,x:L.lx,z:L.lz});
    const b=env.bounds;let min=Infinity;for(let u=0;u<=6;u++)for(let v=0;v<=6;v++){const p=env.world(b.min.x+(b.max.x-b.min.x)*u/6,b.min.z+(b.max.z-b.min.z)*v/6);min=Math.min(min,P.field.edge(...p));if(levelAtRec(rec,...p,0)!==L.y)actualSupportFailures++;if(P.sites.some(site=>site.prim.d(...p)<0))actualSiteIntrusions++;}minimumStreetFieldClearance=Math.min(minimumStreetFieldClearance,min);if(min<0)actualStreetIntrusions++;
  }
  check(!actualRoadPairs,`${id}: ${actualRoadPairs} generated envelopes overlap exact street strips`);
  check(!actualSupportFailures,`${id}: ${actualSupportFailures} generated envelope samples lack foundation`);
  check(!actualSiteIntrusions,`${id}: ${actualSiteIntrusions} generated envelope samples intrude on landmark sites`);
  check(!actualPairs,`${id}: ${actualPairs} overlapping generated architectural envelopes`);
  check(!actualStreetIntrusions,`${id}: ${actualStreetIntrusions} generated architectural envelopes intrude on streets`);
  const furnitureScene=new THREE.Scene(),w=rec.w;
  const wp={streets:P.streets.map(st=>({...st,pts:st.pts.map(([x,z])=>[w.x+x,w.z+z])})),squares:P.squares.map(q=>({...q,x:w.x+q.x,z:w.z+q.z})),lots:P.lots.map(L=>({...L,x:w.x+L.lx,z:w.z+L.lz})),lamps:P.lamps.map(L=>({...L,x:w.x+L.lx,z:w.z+L.lz})),field:{edge:(x,z)=>P.field.edge(x-w.x,z-w.z),centre:(x,z)=>P.field.centre(x-w.x,z-w.z),squareAt:(x,z)=>P.field.squareAt(x-w.x,z-w.z)}};
  const furniture=buildStreetscape(furnitureScene,wp,(x,z)=>Math.max(wardHeight(x,z),terrainHeight(x,z)));
  let furniturePositions=0,furnitureSites=0,furnitureLots=0;const unique=new Set(),m4=new THREE.Matrix4(),p3=new THREE.Vector3();
  furnitureScene.updateMatrixWorld(true);
  furnitureScene.traverse(mesh=>{if(!mesh.isInstancedMesh)return;for(let k=0;k<mesh.count;k++){mesh.getMatrixAt(k,m4);p3.setFromMatrixPosition(m4).applyMatrix4(mesh.matrixWorld);const x=p3.x-w.x,z=p3.z-w.z,key=`${x.toFixed(2)},${z.toFixed(2)}`;if(unique.has(key))continue;unique.add(key);furniturePositions++;if(reserveAt(P,x,z)===2||P.pools.some(p=>p.prim.d(x,z)<0))furnitureSites++;const i=Math.floor(x/size),j=Math.floor(z/size);for(let u=i-reach;u<=i+reach;u++)for(let v=j-reach;v<=j+reach;v++)for(const L of grid.get(`${u},${v}`)||[]){const c=Math.cos(L.rot),s=Math.sin(L.rot),dx=x-L.lx,dz=z-L.lz;if(Math.abs(dx*c-dz*s)<L.w/2+.59&&Math.abs(dx*s+dz*c)<L.d/2+.59)furnitureLots++;}}});
  check(furniturePositions>100,`${id}: production furniture exercised`);
  check(!furnitureSites&&!furnitureLots,`${id}: furniture intrusions sites=${furnitureSites},lots=${furnitureLots}`);
  const local={...rec,w:{...rec.w,x:0,z:0},ctx:{...rec.ctx,features:{lighthouses:[],docks:[],basins:[]}}};
  let triangles=0,courtTriangles=0;
  for(const L of P.landmarks.filter(L=>!['heliostats','arcade'].includes(L.type))){const scene=new THREE.Scene();const built=buildWardLandmarks(scene,local,{...P,landmarks:[L],pools:[],bridges:[]},{topLoops:[]},{palette:rec.design.palette});if(L.type==='wardCourt'||L.type==='arch'){
    const mats=built.meshes.filter(m=>m.isMesh);for(const m of mats)m.material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});scene.updateMatrixWorld(true);
    if(L.type==='wardCourt')for(const side of [-1.5,0,1.5]){const c=Math.cos(L.rot),s=Math.sin(L.rot),origin=new THREE.Vector3(L.x+side*c+19*s,L.y+2,L.z-side*s+19*c),ray=new THREE.Raycaster(origin,new THREE.Vector3(s,0,c),0,L.r+5-19);check(ray.intersectObjects(mats,false).length===0,`${id}: unobstructed civic entrance corridor`);}
    else{const y=levelAtRec(rec,L.x,L.z)+2;const ray=new THREE.Raycaster(new THREE.Vector3(L.x-25,y,L.z),new THREE.Vector3(1,0,0),0,50);check(!ray.intersectObjects(mats,false).length,'Museum Mile arch passage is clear');ray.ray.origin.z+=20;check(ray.intersectObjects(mats,false).length>0,'control ray intersects actual arch pier');}
  }for(const m of built.meshes){if(!m.isMesh)continue;const a=solid(`${id}/${L.type}/${m.name}`,m.geometry,true);triangles+=a.triangles;if(L.type==='wardCourt')courtTriangles+=a.triangles;m.geometry.dispose();}}
  const full=buildWardLandmarks(new THREE.Scene(),{...rec,w:{...rec.w,x:0,z:0}},P,platform,{palette:rec.design.palette});
  for(const mesh of full.meshes)if(mesh.isMesh)solid(`${id}/full-waterfront/${mesh.name}`,mesh.geometry,true);
  // Full production platform coverage, measured by individual material solid so
  // intentional stair/block contacts do not conceal an open component. Terrain
  // skins remain explicit exceptions: quay paving, street caps, sand and seabed.
  // Pool reflections and water patterns are optical shader surfaces, not solids.
  let platformComponents=0,platformTriangles=0,terrainBoundaryEdges=0,platformPassages=0;
  for(const key of ['walls','near','far'])for(const [i,g]of platform[key].entries()){const a=solid(`${id}/platform/${key}/${i}`,g);platformComponents++;platformTriangles+=a.triangles;}
  assert.deepEqual(Object.keys(platform.terrainSurfaces),['quay','grounds','sand','seabed']);
  for(const [key,geos]of Object.entries(platform.terrainSurfaces)){assert.equal(geos,platform[key]);for(const g of geos){const a=auditGeometry(g);check(!a.nonFinite&&!a.invalidNormals,`${id}/terrain/${key}: finite attributes`);terrainBoundaryEdges+=a.boundaryEdges;}}
  check(terrainBoundaryEdges>0,`${id}: open terrain exception is actually exercised`);
  const wallMeshes=platform.walls.map(g=>new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  for(const L of rec.landings)for(const side of [-2,0,2]){const x=L.E[0]+L.side[0]*side,z=L.E[1]+L.side[1]*side;const ray=new THREE.Raycaster(new THREE.Vector3(x-L.t[0]*3,9.7,z-L.t[1]*3),new THREE.Vector3(L.t[0],0,L.t[1]),0,6);check(!ray.intersectObjects(wallMeshes,false).length,`${id}: bridge landing has an unobstructed balustrade opening`);platformPassages++;}
  for(const f of platform.quayStairs){const x=f.p[0]+f.t[0]*.8,z=f.p[1]+f.t[1]*.8;const ray=new THREE.Raycaster(new THREE.Vector3(x+f.n[0]*2,9.7,z+f.n[1]*2),new THREE.Vector3(-f.n[0],0,-f.n[1]),0,4);check(!ray.intersectObjects(wallMeshes,false).length,`${id}: quay stair has a real balustrade opening`);platformPassages++;}
  check(!connectorCollisions,`${id}: ${connectorCollisions} emitted connector/building collisions across both LODs`);
  let publicSamples=0;
  for(const far of [false,true]){
    const landmarkGeos=full.meshes.filter(m=>m.isMesh&&(far?m.name.includes('far')||m.name.endsWith('monuments'):!m.name.includes('far'))).map(m=>m.geometry);
    const idx=faceIndex([...platform.quay,...platform.grounds,...platform.walls,...(far?platform.far:platform.near),...landmarkGeos,...(far?routeHouseFar:routeHouseNear)]);
    for(const route of P.accessRoutes)publicSamples+=walkGeometry(idx,route,`${id}/${far?'far':'near'}/${route.name}`).samples;
    for(const item of platform.connectors){
      if(item.kind==='quay-stair'){
        const f=item.frame,pt=(u,v)=>[f.p[0]+f.t[0]*u+f.n[0]*v,f.p[1]+f.t[1]*u+f.n[1]*v];
        publicSamples+=walkGeometry(idx,{pts:[pt(-11.6,f.offset+1.5),pt(.8,f.offset+1.5),pt(.8,-1.2)],halfWidth:.65,y:3,minY:2.8,maxY:10.5},`${id}/${far?'far':'near'}/quay complete flight`).samples;
        continue;
      }
      if(item.kind!=='terrace-stair')continue;
      const s=item.definition,dx=s.hi[0]-s.lo[0],dz=s.hi[1]-s.lo[1],length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
      let lo=Infinity,hi=-Infinity;for(const g of item.near){const p=g.attributes.position;for(let i=0;i<p.count;i++){const u=p.getX(i)*tx+p.getZ(i)*tz;lo=Math.min(lo,u);hi=Math.max(hi,u);}}
      const cross=s.wall[0]*-tz+s.wall[1]*tx,pt=u=>[tx*u-tz*cross,tz*u+tx*cross];
      publicSamples+=walkGeometry(idx,{pts:[pt(lo-.6),pt(hi+.6)],halfWidth:Math.min(2,s.hw-1),y:s.y0,minY:s.y0-.2,maxY:s.y1+1},`${id}/${far?'far':'near'}/terrace complete flight`).samples;
    }
    for(const [i,br]of P.bridges.entries()){
      const dx=br.b[0]-br.a[0],dz=br.b[1]-br.a[1],length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
      publicSamples+=walkGeometry(idx,{pts:[[br.a[0]-tx*4,br.a[1]-tz*4],[br.b[0]+tx*4,br.b[1]+tz*4]],halfWidth:Math.min(2,br.hw-1),y:br.y,minY:br.y-.2,maxY:br.y+4},`${id}/${far?'far':'near'}/bridge ${i} banks`).samples;
    }
    if(id==='sunward'){
      const L=P.landmarks.find(l=>l.type==='heliodrome');for(let k=0;k<4;k++){const a=L.rot+k*Math.PI/2;publicSamples+=walkGeometry(idx,{pts:[[L.x+Math.cos(a)*62,L.z+Math.sin(a)*62],[L.x+Math.cos(a)*12,L.z+Math.sin(a)*12]],halfWidth:2,y:9,minY:8.8,maxY:45},`sunward/${far?'far':'near'}/summit stair ${k}`).samples;}
    }
    if(id==='aurora'){
      const O=P.landmarks.find(l=>l.type==='observatory');for(const side of [-1,1])publicSamples+=walkGeometry(idx,{pts:[[O.x+side*5.5,O.z+64.1],[O.x+side*5.5,O.z+44]],halfWidth:1.3,y:19,maxY:23},`aurora/${far?'far':'near'}/observatory podium`).samples;
      publicSamples+=walkGeometry(idx,{pts:[[0,441.9],[0,452.6]],halfWidth:1.8,y:9,maxY:11},`aurora/${far?'far':'near'}/library threshold`).samples;
    }
  }
  for(const g of [...routeHouseNear,...routeHouseFar])g.dispose();for(const m of bridgeMeshes)m.geometry.dispose();
  // Repeat structural closure in the actual large-world Float32 coordinates:
  // local-coordinate success alone must not conceal collapsed thin returns.
  const worldPlatform=buildWardPlatform(rec,P);
  for(const key of ['walls','near','far'])for(const [i,g]of worldPlatform[key].entries())solid(`${id}/world-platform/${key}/${i}`,g);
  for(const key of ['walls','near','far','quay','grounds','sand','seabed'])for(const g of worldPlatform[key])g.dispose();
  for(const key of ['walls','near','far','quay','grounds','sand','seabed'])for(const g of platform[key])g.dispose();
  check(courtTriangles>300&&courtTriangles<20000,`${id}: meaningful bounded civic geometry ${courtTriangles}`);
  metrics.push({id,lots:P.lots.length,civicLots:P.lots.filter(L=>L.civic).length,court:court?.name,streetRuns:P.streets.length,bridges:P.bridges.length,stairs:P.stairs.length,groundSamples,roadEdges,roadObstacles,lotPairs,lampSites,landmarkTriangles:triangles,courtTriangles,actualRoadPairs,actualSupportFailures,actualSiteIntrusions,furniturePositions,furnitureSites,furnitureLots,actualPairs,actualStreetIntrusions,minimumStreetFieldClearance,platformComponents,platformTriangles,terrainBoundaryEdges,platformPassages,connectorBuildingPairs,connectorCollisions,actualBuildingLODs,publicSamples,treePathSamples});
}
console.log(JSON.stringify(metrics,null,2));
assert.deepEqual(issues,[],'ward defects');
console.log('WARDS_VERIFIED');
