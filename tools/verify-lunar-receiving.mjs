import assert from 'node:assert/strict';
import * as THREE from 'three';
import {auditGeometry,solidComponents,materialContact} from './geometry-audit.mjs';
import {buildLunarPort} from '../src/space/lunarPort.js';
import {Moon} from '../src/space/moon.js';
import {SpaceSim,R_MOON} from '../src/space/sim.js';
import {SpaceMode} from '../src/space/index.js';
import {TARGET_ORDER,TARGET_INFO} from '../src/space/targets.js';
import {Rings} from '../src/space/rings.js';
import {Traffic} from '../src/space/traffic.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),port=buildLunarPort(),old=buildLunarPort({receiving:false}),court=port.receiving,metrics={};
const geometry=name=>court.parts.find(p=>p.name===name).geo;
function closed(name,g){const a=auditGeometry(g,{tolerance:.001});for(const k of ['boundaryEdges','nonManifoldEdges','inconsistentEdges','degenerates','nonFinite','invalidNormals'])assert.equal(a[k],0,`${name}: ${k}`);assert.ok(a.signedVolume>0);return a;}
closed('complete port',port.geo);for(const p of court.parts)closed(p.name,p.geo);
const gardenMaterial=g=>{const a=g.attributes.aFacade;for(let i=0;i<a.count;i++)if([3,12,13].includes(a.getZ(i)))return true;return false;};
for(const part of court.parts)assert.ok(!gardenMaterial(part.geo),`${part.name}: industrial receiving hardware has no planted-garden shader`);
const wrongRoof=geometry('water-vessel-0').clone();wrongRoof.attributes.aFacade.setZ(0,12);assert.ok(gardenMaterial(wrongRoof),'The former garden-roof material assignment is detected independently from geometry');
metrics.oldTriangles=old.geo.index.count/3;metrics.addedTriangles=(port.geo.index.count-old.geo.index.count)/3;
assert.ok(metrics.addedTriangles>10000&&metrics.addedTriangles<=120000);
const broken=geometry('receiving-ferry').clone();broken.setIndex(Array.from(broken.index.array).slice(3));
assert.ok(auditGeometry(broken,{tolerance:.001}).boundaryEdges>0,'An actual removed hull triangle fails closure');

function contactGraph(parts){
  const roots=solidComponents(port.baseGeo),add=parts.flatMap(p=>solidComponents(p.geo).map(c=>({...c,name:p.name})));
  for(const c of add)assert.ok(c.triangles.reduce((sum,t)=>sum+t.a.dot(t.b.clone().cross(t.c))/6,0)>1e-5,`${c.name}: individual outward component`);
  const all=[...roots,...add],reached=new Set(roots.map((_,i)=>i)),queue=[...reached];
  for(let k=0;k<queue.length;k++)for(let j=roots.length;j<all.length;j++)if(!reached.has(j)&&materialContact(all[queue[k]],all[j])){reached.add(j);queue.push(j);}
  return {count:add.length,disconnected:add.filter((_,i)=>!reached.has(i+roots.length)).map(c=>c.name)};
}
const graph=contactGraph(court.parts);assert.deepEqual(graph.disconnected,[],'Every actual new material component connects to the original port');metrics.connectedAddedSolids=graph.count;
// Independently root the complete port at actual central hub material. This
// prevents an unsupported original component from acting as a false foundation.
const wholePort=solidComponents(port.geo),hubProbe=probeBox(new THREE.Box3(V(-1,-1,-1),V(1,1,1)));
const hubIndices=wholePort.map((c,i)=>materialContact(c,hubProbe)?i:-1).filter(i=>i>=0);
assert.equal(hubIndices.length,1,'The central hub probe lies in exactly one original material component');
const hubReached=new Set(hubIndices),hubQueue=[...hubIndices];
for(let i=0;i<hubQueue.length;i++)for(let j=0;j<wholePort.length;j++)if(!hubReached.has(j)&&materialContact(wholePort[hubQueue[i]],wholePort[j])){hubReached.add(j);hubQueue.push(j);}
assert.equal(hubReached.size,wholePort.length,'Every old and new actual port component reaches the single central hub');
metrics.wholePortConnectedSolids=hubReached.size;

const shifted=court.parts.map(p=>p.name==='ferry-dock'?{...p,geo:p.geo.clone().translate(-2500,0,0)}:p);
assert.ok(contactGraph(shifted).disconnected.includes('ferry-dock'),'A displaced dock loses real contact with its base');
const noSeats=court.parts.filter(p=>!p.name.startsWith('ferry-seat-')&&!p.name.startsWith('transfer-coupling-'));
assert.ok(contactGraph(noSeats).disconnected.includes('receiving-ferry'),'Removing every actual seat and belly coupling leaves the ferry unsupported');
const shiftedSeat=court.parts.map(p=>p.name===court.seats[0].name?{...p,geo:p.geo.clone().translate(0,600,0)}:p);
assert.ok(contactGraph(shiftedSeat).disconnected.includes(court.seats[0].name),'A displaced cradle loses its actual endpoint contacts');

const allComponents=[...solidComponents(port.baseGeo).map(c=>({...c,name:'original-port'})),...court.parts.flatMap(p=>solidComponents(p.geo).map(c=>({...c,name:p.name})))];
function probeBox(box){const c=box.getCenter(V()),s=box.getSize(V());return solidComponents(new THREE.BoxGeometry(...s.toArray()).translate(...c.toArray()))[0];}
function clear(box,components=allComponents){const probe=probeBox(box);return !components.some(c=>materialContact(probe,c));}
function routeComponent(r){const box=new THREE.Box3(r.min,r.max),s=box.getSize(V()),c=box.getCenter(V());const g=new THREE.BoxGeometry(...s.toArray()).translate(...c.toArray());g.applyMatrix4(new THREE.Matrix4().set(1,0,0,0,r.gradeX||0,1,r.gradeZ||0,-(r.gradeX||0)*r.min.x-(r.gradeZ||0)*r.min.z,0,0,1,0,0,0,0,1));return solidComponents(g)[0];}
for(const r of court.crewRoutes){
  const box=new THREE.Box3(r.min,r.max),volume=routeComponent(r);assert.ok(!allComponents.some(c=>materialContact(volume,c)),`${r.name}: actual material clears the whole walking volume`);
  const c=volume.bounds.getCenter(V()),s=volume.bounds.getSize(V());
  assert.ok(materialContact(volume,solidComponents(new THREE.BoxGeometry(2,3,2).translate(...c.toArray()))[0]),'A misplaced cabinet obstructs the actual graded route');
  assert.ok(materialContact(volume,solidComponents(new THREE.BoxGeometry(s.x+10,s.y+10,s.z+10).translate(...c.toArray()))[0]),'An enclosing solid fails even when it contains every graded probe boundary');
}

const triangles=g=>{const p=g.attributes.position,out=[];for(let i=0;i<g.index.count;i+=3)out.push(new THREE.Triangle(...[0,1,2].map(j=>V().fromBufferAttribute(p,g.index.getX(i+j)))));return out;};
const mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const mesh=g=>{const m=new THREE.Mesh(g,mat);m.updateMatrixWorld();return m;};
const allMeshes=[mesh(port.baseGeo),...court.parts.map(p=>mesh(p.geo))];
let floorRays=0,maxFloorGap=0;
for(const r of court.crewRoutes)for(let i=0;i<=50;i++)for(let j=0;j<=4;j++) {
  const point=V(THREE.MathUtils.lerp(r.min.x,r.max.x,j/4),r.min.y,THREE.MathUtils.lerp(r.min.z,r.max.z,i/50));point.y+=(r.gradeX||0)*(point.x-r.min.x)+(r.gradeZ||0)*(point.z-r.min.z);
  const hit=new THREE.Raycaster(point,V(0,-1,0),0,.08).intersectObjects(allMeshes,false)[0];
  assert.ok(hit&&hit.face.normal.y>.99,`${r.name}: physical upward floor at ${point.toArray()}`);floorRays++;maxFloorGap=Math.max(maxFloorGap,hit.distance);
}
metrics.floorRays=floorRays;metrics.maxFloorGapMetres=maxFloorGap;

// The ray grid is supplemented by continuous planar coverage. Break each route
// at every real floor edge/edge crossing. Between those critical x coordinates,
// all projected triangle interval endpoints are affine; endpoint + midpoint
// interval unions certify the entire rectangle, not only a sparse ray set.
const cross=(a,b)=>a.x*b.y-a.y*b.x;
function continuousFloor(route,geometries){
  const floor=route.min.y-.03,tol=.001;
  const polys=geometries.flatMap(triangles).filter(t=>t.getNormal(V()).y>.99&&[t.a,t.b,t.c].every(p=>Math.abs(p.y-floor-(route.gradeX||0)*(p.x-route.min.x)-(route.gradeZ||0)*(p.z-route.min.z))<tol)).map(t=>[t.a,t.b,t.c].map(p=>new THREE.Vector2(p.x,p.z))).filter(p=>Math.max(...p.map(v=>v.x))>=route.min.x&&Math.min(...p.map(v=>v.x))<=route.max.x&&Math.max(...p.map(v=>v.y))>=route.min.z&&Math.min(...p.map(v=>v.y))<=route.max.z);
  const edges=polys.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%3]])),cuts=[route.min.x,route.max.x];
  for(const p of polys)for(const v of p)if(v.x>route.min.x&&v.x<route.max.x)cuts.push(v.x);
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const[a,b]=edges[i],[c,d]=edges[j],u=b.clone().sub(a),v=d.clone().sub(c),den=cross(u,v);
    if(Math.abs(den)<1e-9)continue;
    const w=c.clone().sub(a),t=cross(w,v)/den,s=cross(w,u)/den;
    if(t>=0&&t<=1&&s>=0&&s<=1){const x=a.x+t*u.x;if(x>route.min.x&&x<route.max.x)cuts.push(x);}
  }
  const xs=[...new Set(cuts)].sort((a,b)=>a-b),intervals=x=>polys.flatMap(p=>{
    const zs=[];
    for(let j=0;j<3;j++){const a=p[j],b=p[(j+1)%3];if(x>=Math.min(a.x,b.x)-1e-8&&x<=Math.max(a.x,b.x)+1e-8){if(Math.abs(b.x-a.x)<1e-8)zs.push(a.y,b.y);else zs.push(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));}}
    return zs.length>=2?[[Math.min(...zs),Math.max(...zs)]]:[];
  }).sort((a,b)=>a[0]-b[0]);
  let checks=0;
  for(let i=0;i<xs.length-1;i++)for(const f of [1e-7,.5,1-1e-7]){
    const x=THREE.MathUtils.lerp(xs[i],xs[i+1],f);let end=route.min.z;
    for(const [a,b]of intervals(x)){if(b<end)continue;if(a>end+.001)return false;end=Math.max(end,b);if(end>=route.max.z-.001)break;}
    if(end<route.max.z-.001)return false;checks++;
  }
  return checks>0;
}
const floors=[port.baseGeo,geometry('crew-crossing-floor'),geometry('crew-airlock--1'),geometry('crew-airlock-1')];
for(const route of court.crewRoutes)assert.ok(continuousFloor(route,floors),`${route.name}: actual floor triangles cover its full footprint`);
assert.ok(!continuousFloor(court.crewRoutes[2],[port.baseGeo]),'Removing the crossing slab exposes its unsupported span');
for(const r of court.crewRoutes.slice(5,7))assert.ok(!continuousFloor(r,[geometry('crew-crossing-floor')]),'Removing the port platform invalidates the corresponding lane');
metrics.continuouslySupportedRoutes=court.crewRoutes.length;
for(const r of court.crewRoutes.slice(7))assert.ok(!continuousFloor(r,[port.baseGeo,geometry('crew-crossing-floor')]),'Removing the real pressure-door threshold reveals its unsupported slope');

const ferry=geometry('receiving-ferry');ferry.computeBoundingBox();const ferryBounds=ferry.boundingBox.clone(),ferryMesh=mesh(ferry);
let maxContactGap=0;
for(const seat of court.seats){
  const foot=geometry(seat.name);foot.computeBoundingBox();const center=foot.boundingBox.getCenter(V());
  const hullHit=new THREE.Raycaster(V(center.x,-850,center.z),V(0,1,0),0,30).intersectObject(ferryMesh)[0];
  const topHit=new THREE.Raycaster(V(center.x,-830,center.z),V(0,-1,0),0,30).intersectObject(mesh(foot))[0];
  assert.ok(hullHit&&topHit);assert.ok(hullHit.face.normal.y<-.999&&topHit.face.normal.y>.999);
  const embed=topHit.point.y-hullHit.point.y;assert.ok(embed>=0&&embed<.08);maxContactGap=Math.max(maxContactGap,embed);
  assert.ok(materialContact(solidComponents(foot)[0],solidComponents(geometry('ferry-dock'))[0])||new THREE.Raycaster(V(center.x,-939.9,center.z),V(0,-1,0),0,.2).intersectObject(mesh(geometry('ferry-dock'))).length,'Every cradle foot has a founded dock contact');
}
const staticMaterial=allComponents.filter(c=>c.name!=='receiving-ferry'),contactNames=new Set([...court.seats.map(s=>s.name),'transfer-coupling--125','transfer-coupling-125']);
const initialColumn=ferryBounds.clone();initialColumn.max.y+=court.releaseDistance;
const fixedAway=staticMaterial.filter(c=>!contactNames.has(c.name));
assert.ok(clear(initialColumn,fixedAway),'The complete initial-to-departed hull envelope clears every non-contact fixed component');
let maxEmbed=-Infinity;
for(const name of contactNames){
  const g=geometry(name),components=solidComponents(g);g.computeBoundingBox();
  // Every fixed contact component lies below the measured keel minimum. Once
  // its small designed seating inset is crossed, separation increases forever.
  maxEmbed=Math.max(maxEmbed,g.boundingBox.max.y-ferryBounds.min.y);
  assert.ok(components.some(c=>solidComponents(ferry).some(h=>materialContact(c,h))),`${name}: actual material touches the receiving hull`);
}
assert.ok(maxEmbed>=0&&maxEmbed<.08,'The only intended initial intersections release within eight centimetres');
const departure=ferryBounds.clone();departure.min.y+=maxEmbed+.003;departure.max.y+=court.releaseDistance;
assert.ok(clear(departure,staticMaterial),'The complete continuous departure/arrival volume clears all static material after contact separation');
const overhang=solidComponents(new THREE.BoxGeometry(40,8,40).translate(ferryBounds.getCenter(V()).x,-780,7800));
assert.ok(!clear(initialColumn,[...fixedAway,...overhang]),'A trapping overhang in the first 25 m fails without sampling past it');
const enclosing=solidComponents(new THREE.BoxGeometry(1000,12000,1600).translate(-2880,4500,7800));
assert.ok(!clear(departure,enclosing),'A solid containing the entire departure volume is rejected');
const wrongHead=geometry(court.seats[0].name).clone().translate(0,5,0);wrongHead.computeBoundingBox();
assert.ok(wrongHead.boundingBox.max.y-ferryBounds.min.y>5,'A raised head fails the initial release-plane limit');
metrics.maxSeatInsetMetres=maxContactGap;metrics.fullReleaseDistanceMetres=court.releaseDistance;metrics.maxReleaseInsetMetres=maxEmbed;

// Separate actual water/oxygen pipes, vessels and transfer fittings. They may
// share foundations, but their generated transfer hardware does not intersect.
const waterParts=court.parts.filter(p=>/^water-vessel|^water-process|^transfer-coupling--/.test(p.name));
const oxygenParts=court.parts.filter(p=>/^oxygen-vessel|^oxygen-process|^transfer-coupling-125$/.test(p.name));
for(const a of waterParts)for(const b of oxygenParts)for(const ca of solidComponents(a.geo))for(const cb of solidComponents(b.geo))assert.ok(!materialContact(ca,cb),`${a.name}/${b.name}: separate fluid circuits`);

const sim=new SpaceSim(),moon=new Moon({}),harness={sim,targets:{}};SpaceMode.prototype._defineTargets.call(harness);
assert.ok(TARGET_ORDER.includes('lunarReceiving')&&TARGET_INFO.lunarReceiving);
for(const t of [0,86400,1000000]){
  sim.t=t;sim.update();moon.update(sim,120);
  const actual=moon.port.localToWorld(V(0,-.6,7.6));assert.ok(actual.distanceTo(harness.targets.lunarReceiving.position(V()))<1e-7,'Destination agrees with actual transformed port');
  const q=harness.targets.lunarReceiving.frame(new THREE.Quaternion());assert.ok(Math.abs(q.lengthSq()-1)<1e-12);assert.ok(q.angleTo(moon.port.getWorldQuaternion(new THREE.Quaternion()))<1e-7);
}
// Convert the actual rendered ring and district hulls into port-local metres.
const ringMatrix=new THREE.Matrix4().makeScale(1000,1000,1000).multiply(moon.port.matrixWorld.clone().invert()).multiply(moon.ring.matrixWorld);
const ring=solidComponents(moon.ring.geometry,ringMatrix),districtMatrix=new THREE.Matrix4().makeScale(1000,1000,1000).multiply(moon.port.matrixWorld.clone().invert()).multiply(moon.districts.matrixWorld);
assert.ok(clear(initialColumn,ring),'The entire release column clears the actual overhead ring material');
const allAdded=new THREE.Box3().makeEmpty();for(const p of court.parts){p.geo.computeBoundingBox();allAdded.union(p.geo.boundingBox);}
assert.ok(clear(allAdded,ring),'All receiving machinery lies outside actual occupied ring material');
// Ring districts have a thick pressure rail beyond the slab; measure it too.
const districts=solidComponents(moon.districts.geometry,districtMatrix);
assert.ok(clear(initialColumn,districts)&&clear(allAdded,districts),'Actual district halls and edge pressure rails stay clear');
const ringBox=ring[0].bounds,shiftZ=-(allAdded.min.z-ringBox.max.z+200),intruding=allAdded.clone().translate(V(0,700,shiftZ));
assert.ok(!clear(intruding,ring),'A receiving court moved inward/up into the real ring slab fails');
metrics.ringEdgeGapMetres=allAdded.min.z-ringBox.max.z;
let maxRadius=0;const positions=port.geo.attributes.position;
for(let i=0;i<positions.count;i++)maxRadius=Math.max(maxRadius,V().fromBufferAttribute(positions,i).length());
assert.ok(maxRadius<port.radius*1000,'Port depth-body radius still contains every actual vertex');metrics.maximumPortRadiusKm=maxRadius/1000;

// The existing lunar traffic's whole quadratic-plus-sine path stays outside
// its 2,300 km lunar arrival sphere. Along the actual endpoint direction,
// p(u)=2300+u*(2*(C-2300)+u*(A-2*C+2300))+D*sin(pi*u).
// sin(pi*u)<=pi*u gives a continuous lower bound, including all lane phases.
const scene=new THREE.Scene(),space={scene,addBody:()=>({})},rings=new Rings({},{ringSegs:.25}),traffic=new Traffic(space,rings,{traffic:2000});
let minimumTrafficMargin=Infinity,continuousLanes=0;
for(const t of [0,86400,1000000]){
  sim.t=t;sim.update();traffic.update(sim,120);const u=traffic.uniforms;
  for(let i=0;i<traffic.count;i++)if(traffic.iA[i*4]>=2.5&&traffic.iA[i*4]<3.5){
    const a=u.uGeo.value.clone(),moonPos=u.uMoon.value,side=moonPos.clone().sub(a).cross(V(0,1,0)).normalize(),length=a.distanceTo(moonPos);
    const c=a.clone().add(moonPos).multiplyScalar(.5).addScaledVector(side,length*.22).addScaledVector(V(0,1,0),traffic.iB[i*4]);
    const normal=c.clone().sub(moonPos).normalize(),A=a.clone().sub(moonPos).dot(normal),C=c.clone().sub(moonPos).dot(normal),D=traffic.iA[i*4+2]*side.dot(normal);
    const slope=Math.min(2*(C-2300),A-2300)-Math.PI*Math.abs(D);
    assert.ok(slope>0,'Actual lunar-lane controls keep the whole continuous approach outside its arrival sphere');
    const farthestPort=R_MOON+380+(Math.max(maxRadius,V(...['x','y','z'].map(k=>Math.max(Math.abs(initialColumn.min[k]),Math.abs(initialColumn.max[k])))).length())/1000);
    minimumTrafficMargin=Math.min(minimumTrafficMargin,2300-farthestPort-.2);continuousLanes++;
  }
}
assert.ok(minimumTrafficMargin>150);metrics.continuousTrafficLanes=continuousLanes;metrics.minimumTrafficMarginKm=minimumTrafficMargin;
// The rotating-frame cases above also have an orientation-independent bound.
// Derive its extrema from the generated lane offsets and actual orbit radii.
let maxLane=0,maxVertical=0;for(let i=0;i<traffic.count;i++)if(traffic.iA[i*4]>=2.5&&traffic.iA[i*4]<3.5){maxLane=Math.max(maxLane,Math.abs(traffic.iA[i*4+2]));maxVertical=Math.max(maxVertical,Math.abs(traffic.iB[i*4]));}
const orbitRadius=sim.moonPos.length(),harbourRadius=traffic.uniforms.uGeo.value.length(),dMin=orbitRadius-harbourRadius,dMax=orbitRadius+harbourRadius;
const minC=dMin*.5-maxVertical,minA=dMin*(dMin*.5-maxVertical)/(dMax*Math.hypot(.5,.22)+maxVertical);
const allOrientationSlope=Math.min(2*(minC-2300),minA-2300)-Math.PI*maxLane;
assert.ok(allOrientationSlope>100000,'Every orientation of the fixed-radius Moon and Harbour orbits preserves the complete lunar traffic arrival sphere');
metrics.allOrientationTrafficSlopeKm=allOrientationSlope;
console.log(JSON.stringify(metrics,null,2));console.log('LUNAR_RECEIVING_VERIFIED');
