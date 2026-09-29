import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';
import { buildSolarCollector, WorkingStations } from '../src/space/workingStations.js';
import { CK } from '../src/craft/craftGeometry.js';
import { buildTug } from '../src/craft/craftClasses.js';
import { SpaceMode } from '../src/space/index.js';
import { SpaceSim } from '../src/space/sim.js';
import { TARGET_INFO, TARGET_ORDER } from '../src/space/targets.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const solar=buildSolarCollector(),original=buildSolarCollector({service:false});
const metrics={};
function closed(name,geo) {
  const a=auditGeometry(geo,{tolerance:.001});
  for(const k of ['boundaryEdges','nonManifoldEdges','inconsistentEdges','degenerates','nonFinite','invalidNormals'])assert.equal(a[k],0,`${name}: ${k}`);
  assert.ok(a.signedVolume>0,`${name}: outward volume`);return a;
}
closed('complete Helianth',solar.geo);
for(const p of solar.service.parts)closed(p.name,p.geo);
const shield=solar.service.parts.find(p=>p.name==='habitat-shield').geo;
const openShield=shield.clone();openShield.setIndex(Array.from(shield.index.array).slice(3));
assert.ok(auditGeometry(openShield,{tolerance:.001}).boundaryEdges>0,'A removed shield triangle is detected');
metrics.baseTriangles=original.geo.index.count/3;
metrics.addedTriangles=(solar.geo.index.count-original.geo.index.count)/3;
assert.ok(metrics.addedTriangles>10000&&metrics.addedTriangles<=160000,'Explicit bounded geometry allowance');

// A breadth-first graph over independently extracted closed material components.
// No authored support label, endpoint or bounding-box overlap certifies contact.
function contactGraph(base,parts) {
  const root=solidComponents(base),add=parts.flatMap(p=>solidComponents(p.geo).map((c,i)=>({...c,name:`${p.name}#${i}`})));
  for(const c of add) {
    const volume=c.triangles.reduce((sum,t)=>sum+t.a.dot(t.b.clone().cross(t.c))/6,0);
    assert.ok(volume>1e-4,`${c.name}: every individual material component faces outward`);
  }
  const all=[...root,...add],reached=new Set(root.map((_,i)=>i)),queue=[...reached],edges=[];
  for(let qi=0;qi<queue.length;qi++) {
    const i=queue[qi];
    for(let j=root.length;j<all.length;j++)if(!reached.has(j)&&materialContact(all[i],all[j])){reached.add(j);queue.push(j);edges.push([i,j]);}
  }
  return {connected:add.length,edges,disconnected:add.filter((_,i)=>!reached.has(i+root.length)).map(p=>p.name)};
}
const graph=contactGraph(solar.baseGeo,solar.service.parts);
assert.deepEqual(graph.disconnected,[],'Every added closed component contacts material connected to the original station');
metrics.connectedAddedSolids=graph.connected;
const shifted=solar.service.parts.map(p=>p.name==='receiving-gantry'?{...p,geo:p.geo.clone().translate(0,700,0)}:p);
assert.ok(contactGraph(solar.baseGeo,shifted).disconnected.some(n=>n.startsWith('receiving-gantry')),'A displaced handling gantry loses its real material connection');
const shiftedFoot=solar.service.parts.map(p=>p.name==='tug-foot--20--130'?{...p,geo:p.geo.clone().translate(0,800,0)}:p);
assert.ok(contactGraph(solar.baseGeo,shiftedFoot).disconnected.some(n=>n.startsWith('tug-foot')),'A detached foot fails the independent material-contact graph');

function subset(geo,predicate) {
  const g=geo.clone(),idx=[];
  for(let i=0;i<geo.index.count;i+=3)if(predicate(i))idx.push(geo.index.getX(i),geo.index.getX(i+1),geo.index.getX(i+2));
  g.setIndex(idx);g.computeBoundingBox();g.computeBoundingSphere();return g;
}
// The shared tug used to have detached fore and aft clamp frames. Removing only
// the actual new bracket triangles restores that failure at both tested scales.
for(const length of [80,360]) {
  const t=buildTug(length),c=solidComponents(t.geo),root=c.findIndex(x=>x.bounds.containsPoint(V(0,0,-25*length/80)));
  assert.ok(root>=0);
  const graphOf=parts=>{
    const reached=new Set([root]),queue=[root];
    for(let qi=0;qi<queue.length;qi++)for(let j=0;j<parts.length;j++)if(!reached.has(j)&&materialContact(parts[queue[qi]],parts[j])){reached.add(j);queue.push(j);}
    return parts.length-reached.size;
  };
  assert.equal(graphOf(c),0,`All ${length} m tug components connect to the actual engine/spine`);
  const noBrackets=subset(t.geo,i=>!t.clampBrackets.some(r=>i>=r.start&&i<r.start+r.count));
  assert.ok(graphOf(solidComponents(noBrackets))>=8,'Removing the actual brackets detaches both original end clamp frames');
}

const probeMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const mesh=geo=>{const m=new THREE.Mesh(geo,probeMaterial);m.updateMatrixWorld();return m;};
const tug=solar.service.parts.find(p=>p.name==='service-tug').geo,tugProbe=mesh(tug),pad=mesh(solar.service.parts.find(p=>p.name==='receiving-pad').geo);
tug.computeBoundingBox();
let maxFootError=0;
for(const f of solar.service.feet) {
  const hit=new THREE.Raycaster(f.root,V(0,1,0),0,200).intersectObject(tugProbe)[0];
  assert.ok(hit);maxFootError=Math.max(maxFootError,hit.point.distanceTo(f.contact));
  assert.ok(new THREE.Raycaster(f.root.clone().add(V(0,20,0)),V(0,-1,0),0,25).intersectObject(pad).length,'Each cradle foot sits on real pad material');
  assert.equal(new THREE.Raycaster(f.root.clone().add(V(250,0,0)),V(0,1,0),0,200).intersectObject(tugProbe).length,0,'Shifted foot misses the real hull');
}
assert.ok(maxFootError<.001);metrics.maxFootContactErrorMetres=maxFootError;

const tmp=V();
function triangles(geo) {
  const p=geo.attributes.position,out=[];
  for(let i=0;i<geo.index.count;i+=3)out.push(new THREE.Triangle(V().fromBufferAttribute(p,geo.index.getX(i)),V().fromBufferAttribute(p,geo.index.getX(i+1)),V().fromBufferAttribute(p,geo.index.getX(i+2))));
  return out;
}
const staticParts=[...solidComponents(solar.baseGeo).map(c=>({...c,name:'original-station'})),...solar.service.parts.filter(p=>p.name!=='service-tug').flatMap(p=>solidComponents(p.geo).map(c=>({...c,name:p.name})))];
function clear(box,list=staticParts) {
  const size=box.getSize(V()),center=box.getCenter(V());
  const volume=solidComponents(new THREE.BoxGeometry(...size.toArray()).translate(...center.toArray()))[0];
  return !list.some(c=>materialContact(volume,c));
}
for(const r of solar.service.crewRoutes) {
  const b=new THREE.Box3(r.min,r.max);assert.ok(clear(b),`${r.name}: actual triangles clear the reserved walking volume`);
  const obstruction=solidComponents(new THREE.BoxGeometry(3,5,3).translate(...b.getCenter(V()).toArray()));
  assert.ok(!clear(b,obstruction),'A misplaced locker blocks the measured crew lane');
  const enclosing=solidComponents(new THREE.BoxGeometry(60,60,600).translate(...b.getCenter(V()).toArray()));
  assert.ok(!clear(b,enclosing),'An oversized solid enclosing the whole lane also fails, even without boundary intersections');
}
const laneGround=solar.service.parts.map(p=>({...p,mesh:mesh(p.geo)}));
let groundProbes=0,maxLaneFloorGap=0;
for(const r of solar.service.crewRoutes) {
  const unsupported=laneGround.filter(p=>p.name!==`service-wing-${r.side}`&&p.name!==`wing-edging-${r.side}`);
  for(let j=0;j<=26;j++)for(let k=0;k<=4;k++) {
    const origin=V(THREE.MathUtils.lerp(r.min.x,r.max.x,k/4),r.min.y,THREE.MathUtils.lerp(r.min.z,r.max.z,j/26));
    const ray=new THREE.Raycaster(origin,V(0,-1,0),0,.1),hit=ray.intersectObjects(laneGround.map(p=>p.mesh),false)[0];
    assert.ok(hit&&hit.face.normal.y>.99,'The reserved crew lane is supported by real upward deck triangles');
    maxLaneFloorGap=Math.max(maxLaneFloorGap,hit.distance);groundProbes++;
    assert.equal(ray.intersectObjects(unsupported.map(p=>p.mesh),false).length,0,'Removing the actual wing floor leaves the crew lane unsupported');
  }
}
metrics.laneFloorProbes=groundProbes;metrics.maximumLaneFloorGapMetres=maxLaneFloorGap;

// Exact projected triangle overlap bounds the cradle's vertical embed. Both
// surfaces are affine over each overlap polygon, so its vertices give the true
// extrema; this does not skip a small hook or overhang between ray samples.
const cross2=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const projected=t=>[t.a,t.b,t.c].map(p=>new THREE.Vector2(p.x,p.z));
function overlap(a,b) {
  let polygon=projected(a);const q=projected(b),sign=Math.sign(cross2(...q));
  for(let j=0;j<3;j++) {
    const p=q[j],r=q[(j+1)%3],next=[];
    for(let k=0;k<polygon.length;k++) {
      const u=polygon[k],v=polygon[(k+1)%polygon.length],du=cross2(p,r,u)*sign,dv=cross2(p,r,v)*sign;
      if(du>=-1e-8)next.push(u);
      if((du<0)!==(dv<0))next.push(u.clone().lerp(v,du/(du-dv)));
    }
    polygon=next;
  }
  return polygon;
}
function height(t,p){const n=t.getNormal(V());return t.a.y-(n.x*(p.x-t.a.x)+n.z*(p.y-t.a.z))/n.y;}
const underHull=triangles(tug).filter(t=>t.getNormal(V()).y<-.0001);
function verticalEmbed(geo) {
  let max=-Infinity;
  for(const top of triangles(geo).filter(t=>t.getNormal(V()).y>.0001))for(const lower of underHull)for(const p of overlap(top,lower))max=Math.max(max,height(top,p)-height(lower,p));
  return max;
}
let maxCradleEmbed=0;
for(const p of solar.service.parts.filter(p=>p.name.startsWith('tug-foot')))maxCradleEmbed=Math.max(maxCradleEmbed,verticalEmbed(p.geo));
assert.ok(maxCradleEmbed>0&&maxCradleEmbed<.2,'Every actual cradle component clears the translated lower hull after less than 20 cm of vertical release');
const oldHead=solar.service.feet[0].contact.clone().add(V(0,.3,0));
assert.ok(verticalEmbed(new THREE.BoxGeometry(13,3,14).translate(...oldHead.toArray()))>7,'The original horizontal engine head reproduces excessive facet penetration');
metrics.maximumCradleEmbedMetres=maxCradleEmbed;
const departureStructure=staticParts.filter(p=>!p.name.startsWith('tug-foot'));
const release=tug.boundingBox.clone();release.max.y+=25;
assert.ok(clear(release,departureStructure),'The full 0–25 m release envelope has no obstruction beyond the proven shallow cradle seating');
assert.ok(!clear(release,solidComponents(new THREE.BoxGeometry(20,1,20).translate(900,3675,60))),'A trapping overhang in the first 25 metres is detected');
const approach=new THREE.Box3(solar.service.approach.min,solar.service.approach.max);
assert.ok(clear(approach,departureStructure),'The departure column clears all actual station triangles');
for(const h of [25,50,100,250,500,1000,1800]) {
  const swept=tug.boundingBox.clone().translate(V(0,h,0));
  assert.ok(clear(swept,departureStructure),`Actual tug bounds clear structure after ${h} m vertical departure`);
}
const continuousDeparture=tug.boundingBox.clone();continuousDeparture.min.y+=25;continuousDeparture.max.y+=1800;
assert.ok(clear(continuousDeparture,departureStructure),'The complete swept prism between departure samples is clear as well');
const blockedDeparture=solidComponents(new THREE.BoxGeometry(30,30,30).translate(900,4000,60));
assert.ok(!clear(continuousDeparture,blockedDeparture),'A misplaced overhead fitting blocks the continuous departure volume');
metrics.clearCrewLanes=solar.service.crewRoutes.length;metrics.departureSamples=7;

// Ray traversal uses independent triangle trees. Habitat triangles are excluded
// from its blocking mesh: a pressure shell cannot certify its own solar shield.
function blocks(components,origin,direction,far=40000) {
  const ray=new THREE.Ray(origin,direction),hit=V();
  const visit=node=>{
    if(!ray.intersectsBox(node.bounds))return false;
    if(node.triangles)return node.triangles.some(t=>ray.intersectTriangle(t.a,t.b,t.c,false,hit)&&hit.distanceToSquared(origin)>.00001&&hit.distanceToSquared(origin)<far*far);
    return visit(node.left)||visit(node.right);
  };
  return components.some(c=>visit(c.tree));
}
const r=solar.habitatRange,habitat=subset(solar.baseGeo,i=>i>=r.start&&i<r.start+r.count);
const baseBlockers=solidComponents(subset(original.baseGeo,i=>i<r.start||i>=r.start+r.count));
const shieldBlockers=solidComponents(shield),displacedShield=solidComponents(shield.clone().translate(1800,0,0));
const sun=V(0,-Math.hypot(3740000,598400)*1000,0),sunRadius=696000000;
let rays=0,baseBlocked=0,shieldBlocked=0,shiftedBlocked=0,surfacePoints=0;
for(const [i,t]of triangles(habitat).entries()) {
  if(i%9)continue;
  surfacePoints++;
  const normal=t.getNormal(V()),point=t.getMidpoint(V()),axis=sun.clone().sub(point).normalize();
  const angle=Math.asin(sunRadius/sun.distanceTo(point)),u=V(1,0,0).cross(axis).normalize(),v=axis.clone().cross(u);
  for(const fraction of [0,.33,.67,.95,1])for(let k=0;k<(fraction?32:1);k++) {
    const a=k/32*Math.PI*2,dir=axis.clone().multiplyScalar(Math.cos(angle*fraction)).addScaledVector(u,Math.cos(a)*Math.sin(angle*fraction)).addScaledVector(v,Math.sin(a)*Math.sin(angle*fraction));
    if(dir.dot(normal)<.0001)continue;
    const origin=point.clone().addScaledVector(normal,.1);rays++;
    if(blocks(baseBlockers,origin,dir))baseBlocked++;
    if(blocks(shieldBlockers,origin,dir))shieldBlocked++;
    if(blocks(displacedShield,origin,dir))shiftedBlocked++;
  }
}
assert.ok(surfacePoints>500&&rays>30000,'A dense finite solar disc and actual partly exposed side surfaces were sampled');
assert.equal(shieldBlocked,rays,'The actual closed annular shield intercepts every sampled outward solar-disc direction');
assert.ok(baseBlocked/rays<.98,'The unshielded source-generated station exposes the original finite-Sun gaps');
assert.ok(shiftedBlocked/rays<.98,'A materially displaced shield fails the coverage requirement');
metrics.solarHalfAngleDegrees=Math.asin(sunRadius/sun.length())*180/Math.PI;
metrics.habitatSurfacePoints=surfacePoints;metrics.solarDiscRays=rays;metrics.baselineCoverage=baseBlocked/rays;metrics.shieldCoverage=shieldBlocked/rays;

// Complement the finite rays with a conservative continuous bound. At y=1130
// the actual shield triangles form two closed, once-winding polygonal loops.
// Their inradius/circumradius enclose an uninterrupted material annulus. Bound
// the entire habitat surface and every direction in the apparent solar disc
// against that annulus, including directions between the sampled rays.
const shieldPlane=1130,slice=[];
const distanceToSegment=(a,b)=>{const d=b.clone().sub(a),t=d.lengthSq()?THREE.MathUtils.clamp(-a.dot(d)/d.lengthSq(),0,1):0;return a.clone().addScaledVector(d,t).length();};
for(const t of triangles(shield)) {
  const vertices=[t.a,t.b,t.c],hits=[];
  for(let i=0;i<3;i++) {
    const a=vertices[i],b=vertices[(i+1)%3];
    if((a.y-shieldPlane)*(b.y-shieldPlane)<0){const p=a.clone().lerp(b,(shieldPlane-a.y)/(b.y-a.y));hits.push(new THREE.Vector2(p.x,p.z));}
  }
  if(hits.length===2)slice.push(hits);
}
assert.ok(slice.length>700,'The shield slice intersects actual inner and outer material boundaries');
const means=slice.map(([a,b])=>(a.length()+b.length())/2),split=(Math.min(...means)+Math.max(...means))/2;
const loops=[slice.filter((_,i)=>means[i]<split),slice.filter((_,i)=>means[i]>=split)];
for(const loop of loops) {
  const degree=new Map(),adj=new Map();let winding=0;
  const key=p=>`${Math.round(p.x*1000)},${Math.round(p.y*1000)}`;
  for(const [a,b]of loop) {
    const ka=key(a),kb=key(b);for(const k of [ka,kb])degree.set(k,(degree.get(k)||0)+1);
    adj.set(ka,[...(adj.get(ka)||[]),kb]);adj.set(kb,[...(adj.get(kb)||[]),ka]);
    winding+=Math.abs(Math.atan2(a.cross(b),a.dot(b)));
  }
  assert.ok([...degree.values()].every(n=>n===2),'Every slice vertex has two real material boundary edges');
  const seen=new Set([degree.keys().next().value]),queue=[...seen];for(let i=0;i<queue.length;i++)for(const n of adj.get(queue[i]))if(!seen.has(n)){seen.add(n);queue.push(n);}
  assert.equal(seen.size,degree.size,'Each shield boundary is one continuous closed loop');
  assert.ok(Math.abs(winding-Math.PI*2)<1e-7,'Each actual shield boundary surrounds the entire station axis once');
}
const holeRadius=Math.max(...loops[0].flatMap(e=>e.map(p=>p.length()))),outerInradius=Math.min(...loops[1].map(([a,b])=>distanceToSegment(a,b)));
let habitatMinRadius=Infinity,habitatMaxRadius=0,habitatMinY=Infinity,habitatMaxY=-Infinity;
for(const t of triangles(habitat)) {
  const q=projected(t);for(let i=0;i<3;i++)habitatMinRadius=Math.min(habitatMinRadius,distanceToSegment(q[i],q[(i+1)%3]));
  const turns=q.map((p,i)=>cross2(p,q[(i+1)%3],new THREE.Vector2()));
  if(Math.abs(cross2(...q))>1e-8&&(turns.every(n=>n>=0)||turns.every(n=>n<=0)))habitatMinRadius=0;
  for(const p of [t.a,t.b,t.c]){habitatMaxRadius=Math.max(habitatMaxRadius,Math.hypot(p.x,p.z));habitatMinY=Math.min(habitatMinY,p.y);habitatMaxY=Math.max(habitatMaxY,p.y);}
}
const nearestSunPlane=sun.length()+habitatMinY,coneBound=Math.asin(sunRadius/nearestSunPlane)+Math.atan2(habitatMaxRadius,nearestSunPlane);
assert.ok(habitatMinY>shieldPlane,'The common material plane stays between the entire habitat and the Sun');
const maxLateralShift=(habitatMaxY-shieldPlane)*Math.tan(coneBound);
const continuousMargin=Math.min(habitatMinRadius-maxLateralShift-holeRadius,outerInradius-habitatMaxRadius-maxLateralShift);
assert.ok(continuousMargin>100,'The complete finite solar cone from the bounded habitat fits inside the actual uninterrupted shield annulus');
assert.ok(habitatMinRadius-maxLateralShift-holeRadius-1800<0,'Displacing the inner shield boundary by the control distance invalidates the continuous bound');
metrics.continuousShadowMarginMetres=continuousMargin;

// Both faces of every existing radiator keep their finite cone of cold-space
// sightlines. The emitter alone is excluded, not neighbouring structure.
let coldSpaceRays=0;
for(const rr of solar.radiators) {
  const panel=subset(solar.baseGeo,i=>i>=rr.start&&i<rr.start+rr.count);
  const blockers=solidComponents(subset(solar.geo,i=>i<rr.start||i>=rr.start+rr.count));
  for(const t of triangles(panel)) {
    const n=t.getNormal(V()),point=t.getMidpoint(V()),radial=point.clone().setY(0).normalize();
    if(Math.abs(n.y)>.01||Math.abs(n.dot(radial))>.01)continue;
    const o=point.clone().addScaledVector(n,.1),u=V(0,1,0),v=n.clone().cross(u);
    for(let k=-1;k<8;k++) {
      const a=k/8*Math.PI*2,dir=k<0?n:n.clone().multiplyScalar(Math.cos(.3)).addScaledVector(u,Math.cos(a)*Math.sin(.3)).addScaledVector(v,Math.sin(a)*Math.sin(.3));
      assert.ok(!blocks(blockers,o,dir),`Radiator face remains open to cold space, panel ${rr.start}`);coldSpaceRays++;
    }
    const occluder=solidComponents(new THREE.BoxGeometry(100,100,100).translate(...o.clone().addScaledVector(n,100).toArray()));
    assert.ok(blocks(occluder,o,n),'A placed obstruction blocks the actual radiator sightline');
  }
}
assert.ok(coldSpaceRays>=200);metrics.coldSpaceRays=coldSpaceRays;

let maxRadius=0;const pos=solar.geo.attributes.position;
for(let i=0;i<pos.count;i++)maxRadius=Math.max(maxRadius,tmp.fromBufferAttribute(pos,i).length());
assert.ok(maxRadius<=solar.radius*1000,'All additions stay inside the existing render-body bound');
metrics.maximumRadiusKm=maxRadius/1000;
const sim=new SpaceSim(),space={scene:new THREE.Scene(),earthFixed:new THREE.Group(),addBody:()=>{}};
const works=new WorkingStations(space);const harness={sim,targets:{}};SpaceMode.prototype._defineTargets.call(harness);
assert.ok(TARGET_ORDER.includes('solarService')&&TARGET_INFO.solarService,'The close service destination is discoverable');
for(const time of [0,10000,1000000]) {
  sim.t=time;sim.update();works.update(sim);space.scene.updateMatrixWorld(true);
  const actual=works.solar.localToWorld(V(0,3.7,0)),target=harness.targets.solarService.position(V());
  assert.ok(actual.distanceTo(target)<1e-6,'Analytic destination agrees with the actual transformed crown');
  const actualSun=sim.sunPos.clone().sub(works.solar.getWorldPosition(V())).normalize(),shaderSun=works.solar.children[0].userData.sunDir;
  assert.ok(actualSun.distanceTo(shaderSun)<1e-10,'Helianth lighting uses its local world-space direction to the Sun');
  assert.ok(actualSun.distanceTo(sim.sunDir)>1,'The inherited Earth reference is an effective wrong-direction control');
  const frame=harness.targets.solarService.frame(new THREE.Quaternion());assert.ok(Math.abs(frame.length()-1)<1e-12);
}
// ---- wave 3 refinements: cladding courses, glazing and beacons (by kind and placement)
{
  const kindArea=(geo,strict=true)=>{const p=geo.attributes.position,f=geo.attributes.aFacade,ix=geo.index,out={},A=V(),B=V(),C=V();
    for(let i=0;i<ix.count;i+=3){const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2);A.fromBufferAttribute(p,a);B.fromBufferAttribute(p,b);C.fromBufferAttribute(p,c);
      const k=Math.round(f.getZ(a));if(strict)assert.ok(Math.round(f.getZ(b))===k&&Math.round(f.getZ(c))===k,'one kind per face (no interpolated kind bands)');
      out[k]=(out[k]||0)+B.clone().sub(A).cross(C.clone().sub(A)).length()/2;}return out;};
  let maxI=0;const ix=solar.geo.index;for(let i=0;i<ix.count;i++)maxI=Math.max(maxI,ix.getX(i));assert.ok(maxI<solar.geo.attributes.position.count,'index in range');
  const sh=kindArea(shield);
  assert.ok(sh[CK.BRONZE]>1e7&&sh[CK.DARK]>1e6,'shield top clad in blanket courses with dark joints');
  for(const name of ['habitat-belt-4480-2200','habitat-belt-3720-2200','habitat-belt-4100-2580','habitat-belt-4100-1820'])assert.ok(kindArea(solar.service.parts.find(p=>p.name===name).geo)[CK.GLASS]>1e5,`${name} glazed`);
  for(const sd of [-1,1])assert.ok(kindArea(solar.service.parts.find(p=>p.name===`service-wing-${sd}`).geo)[CK.GLASS]>1e4,'wing glazing');
  const base=kindArea(solar.baseGeo,false);assert.ok(base[CK.GLASS]>1e6&&base[CK.CONDUIT]>1e5,'hub glazed decks and spoke conduits');
  // beacons sit on the shield's outer wall and the wheel's crown belt
  const rim=solar.lamps.filter(l=>Math.abs(Math.hypot(l.p.x,l.p.z)-5112)<1&&Math.abs(l.p.y-1086)<1),crown=solar.lamps.filter(l=>Math.abs(Math.hypot(l.p.x,l.p.z)-4100)<1&&Math.abs(l.p.y-2596)<1);
  assert.equal(rim.length,16);assert.equal(crown.length,12);
  for(const l of [...rim,...crown])assert.ok(Number.isFinite(l.p.x+l.p.y+l.p.z)&&l.i>0&&l.r>0);
  metrics.refinement={shieldBlanketM2:Math.round(sh[CK.BRONZE]),glazedHubM2:Math.round(base[CK.GLASS]),conduitM2:Math.round(base[CK.CONDUIT]),beacons:rim.length+crown.length};
}
console.log(JSON.stringify(metrics,null,2));
console.log('SOLAR_SERVICE_VERIFIED');
