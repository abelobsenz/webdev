import assert from 'node:assert/strict';
import * as THREE from 'three';
import {auditGeometry,solidComponents,materialContact} from './geometry-audit.mjs';
import {buildRefinery,buildTender} from '../src/craft/craftGeometry.js';
import {buildFoundry,WorkingStations} from '../src/space/workingStations.js';
import {Fleet} from '../src/space/fleet.js';
import {Elevator} from '../src/space/elevator.js';
import {SpaceSim} from '../src/space/sim.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),metrics={};
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const mesh=g=>{const m=new THREE.Mesh(g,material);m.updateMatrixWorld(true);return m;};
function subset(geo,predicate){const out=geo.clone(),idx=[];for(let i=0;i<geo.index.count;i+=3)if(predicate(i))idx.push(...geo.index.array.slice(i,i+3));out.setIndex(idx);return out;}
function supports(data){return data.supportRanges.map(r=>({name:r.name,geo:subset(data.geo,i=>i>=r.start&&i<r.start+r.count)}));}
function withoutSupports(data){return subset(data.geo,i=>!data.supportRanges.some(r=>i>=r.start&&i<r.start+r.count));}
function closed(g){const a=auditGeometry(g,{tolerance:.001});for(const k of ['boundaryEdges','nonManifoldEdges','inconsistentEdges','degenerates','nonFinite','invalidNormals'])assert.equal(a[k],0,k);assert.ok(a.signedVolume>0);return a;}
function box(min,max){const s=max.clone().sub(min),c=min.clone().add(max).multiplyScalar(.5);return solidComponents(new THREE.BoxGeometry(...s.toArray()).translate(...c.toArray()))[0];}
function graph(components,rootPoint){const probe=box(rootPoint.clone().addScalar(-1),rootPoint.clone().addScalar(1)),roots=components.flatMap((c,i)=>materialContact(c,probe)?[i]:[]);assert.equal(roots.length,1,'One independently located original structural root');const reached=new Set(roots),queue=[...roots];for(let i=0;i<queue.length;i++)for(let j=0;j<components.length;j++)if(!reached.has(j)&&materialContact(components[queue[i]],components[j])){reached.add(j);queue.push(j);}return {root:components[roots[0]],connected:reached.size,disconnected:components.length-reached.size};}
function pointComponent(components,p){const q=box(p.clone().addScalar(-.1),p.clone().addScalar(.1)),found=components.filter(c=>materialContact(c,q));assert.equal(found.length,1,`Unique original solid at ${p.toArray()}`);return found[0];}
function projectedArea(component,panel){
  // The convex hull encloses every projected material triangle, even if an
  // authored component later becomes concave. Clip it to the actual panel face.
  const points=component.vertices.map(v=>[v.x,v.z]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=ps=>{const h=[];for(const p of ps){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
  let polygon=[...half(points).slice(0,-1),...half(points.slice().reverse()).slice(0,-1)];
  for(const [axis,value,sign]of[[0,panel.min.x,1],[0,panel.max.x,-1],[1,panel.min.z,1],[1,panel.max.z,-1]]){
    const out=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],ina=(a[axis]-value)*sign>=0,inb=(b[axis]-value)*sign>=0;if(ina)out.push(a);if(ina!==inb){const t=(value-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}polygon=out;
  }
  return Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
}
const selene=buildRefinery(),oldSelene=buildRefinery(1,{supports:false}),foundry=buildFoundry(),oldFoundry=buildFoundry({supports:false});
const sc=solidComponents(selene.geo),fc=solidComponents(foundry.geo),oldSC=solidComponents(oldSelene.geo),oldFC=solidComponents(oldFoundry.geo);
const ss=supports(selene),fs=supports(foundry),seleneRoot=V(),foundryRoot=V(6300,-1300,1800);
for(const [name,data,old,cs,oldcs,parts,root,defects]of[['Selene',selene,oldSelene,sc,oldSC,ss,seleneRoot,42],['Foundry',foundry,oldFoundry,fc,oldFC,fs,foundryRoot,8]]){
  closed(data.geo);parts.forEach(p=>closed(p.geo));
  for(const c of cs)assert.ok(c.triangles.reduce((sum,t)=>sum+t.a.dot(t.b.clone().cross(t.c))/6,0)>0,'Every extracted material solid faces outward');
  const current=graph(cs,root);assert.equal(current.disconnected,0,`${name}: every original and added solid is connected`);
  assert.equal(graph(oldcs,root).disconnected,defects,`${name}: source-built original reproduces measured missing supports`);
  assert.equal(graph(solidComponents(withoutSupports(data)),root).disconnected,defects,`${name}: removing only actual support triangles reproduces original defects`);
  metrics[`${name.toLowerCase()}ConnectedSolids`]=current.connected;
  metrics[`${name.toLowerCase()}AddedTriangles`]=(data.geo.index.count-old.geo.index.count)/3;
}
metrics.addedTriangles=metrics.seleneAddedTriangles+metrics.foundryAddedTriangles;assert.ok(metrics.addedTriangles>0&&metrics.addedTriangles<=10000);
const open=ss[0].geo.clone();open.setIndex(Array.from(open.index.array).slice(3));assert.ok(auditGeometry(open,{tolerance:.001}).boundaryEdges>0,'Removing a real collar triangle exposes an opening');
// Names only choose real triangle subsets; all contacts below are measured against
// independently extracted original solids, never accepted from author metadata.
const spindle=graph(oldSC,seleneRoot).root;
for(const y of [-2200,-1500,-1000]){
  const collar=solidComponents(ss.find(p=>p.name===`manifold-root-${y}`).geo)[0];assert.ok(materialContact(collar,spindle));
  for(let k=0;k<6;k++){const a=k*Math.PI/3,pipe=pointComponent(oldSC,V(Math.cos(a)*300,y,Math.sin(a)*300));assert.ok(materialContact(collar,pipe),'Each real manifold collar meets all six old pipe roots');}
}
for(let k=0;k<4;k++){
  const a=k*Math.PI/2+Math.PI/4,root=solidComponents(ss.find(p=>p.name===`radiator-root-${k}`).geo)[0],beam=pointComponent(oldSC,V(Math.cos(a)*300,-1350,Math.sin(a)*300));assert.ok(materialContact(root,spindle)&&materialContact(root,beam),'Radiator root overlaps actual spindle and existing beam');
}
const detachedSelene=[...oldSC,...ss.flatMap(p=>solidComponents(p.geo,new THREE.Matrix4().makeTranslation(p.name.startsWith('manifold')?3000:0,0,0)))];assert.ok(graph(detachedSelene,seleneRoot).disconnected>=26,'Displaced manifold collars restore disconnected process material');
// Every guide has six physically founded seats. Cast feet touch the actual deck;
// the separate dark saddle meets the real lower facet of the hexagonal lantern.
let seatedGuides=0,seatFloorMaxGap=0;
for(const x of [-4800,-3600,-600,600,3600,4800]){
  const guide=pointComponent(oldFC,V(x,-950,-500));
  const deck=pointComponent(oldFC,V(Math.round(x/4200)*4200,-1100,-500));
  for(let j=0;j<6;j++){
    const part=fs.find(p=>p.name===`guide-seat-${x}-${j}`),parts=solidComponents(part.geo),z=-3500+j*1000;
    assert.equal(parts.length,2);const foot=parts.find(c=>c.bounds.min.y< -985),head=parts.find(c=>c!==foot);
    assert.ok(materialContact(foot,deck)&&materialContact(foot,head)&&materialContact(head,guide),'Floor-to-foot-to-saddle-to-guide is a material path');
    const hit=new THREE.Raycaster(V(x,-989.95,z),V(0,-1,0),0,1).intersectObject(mesh(oldFoundry.geo))[0];assert.ok(hit&&hit.face.normal.y>.99);seatFloorMaxGap=Math.max(seatFloorMaxGap,hit.distance);
    const raised=solidComponents(part.geo,new THREE.Matrix4().makeTranslation(0,100,0));assert.ok(!raised.some(c=>materialContact(c,deck)||materialContact(c,guide)),'A displaced seat loses both deck and guide support');
    seatedGuides++;
  }
}
metrics.guideSeats=seatedGuides;metrics.maxSeatFloorProbeGapMetres=seatFloorMaxGap;
// Crossarm -> longitudinal spine -> transverse spar -> each real panel. The
// diagonal stays also touch the original arm and the spine, rather than floating.
let minimumRadiatorExposure=1,minimumWholeRadiatorExposure=1;
for(const s of [-1,1]){
  const arm=pointComponent(oldFC,V(s*8000,-1000,4600)),spine=solidComponents(fs.find(p=>p.name===`radiator-spine-${s}`).geo)[0];assert.ok(materialContact(arm,spine));
  for(let j=0;j<3;j++){
    const z=3350+j*1250,panel=pointComponent(oldFC,V(s*9500,-950,z)),spar=solidComponents(fs.find(p=>p.name===`radiator-spar-${s}-${j}`).geo)[0];assert.ok(materialContact(spine,spar)&&materialContact(spar,panel));
    // Exact conservative projected-area upper bound over all actual added solids.
    // Triangle footprints are enclosed by projected convex hulls, and summed
    // without subtracting overlaps. This proves a lower exposure bound everywhere,
    // not merely a sparse selection of unobstructed rays.
    const p=panel.bounds,area=(p.max.x-p.min.x)*(p.max.z-p.min.z);let blocked=0;
    for(const c of fs.flatMap(p=>solidComponents(p.geo)))blocked+=projectedArea(c,p);
    const exposed=1-blocked/area;minimumRadiatorExposure=Math.min(minimumRadiatorExposure,exposed);assert.ok(exposed>.85,'Most radiator face remains geometrically exposed even with conservative overlapping projected shadows');
    const originalBlock=oldFC.filter(c=>c!==panel).reduce((sum,c)=>sum+projectedArea(c,p),0);
    const wholeExposure=1-(blocked+originalBlock)/area;minimumWholeRadiatorExposure=Math.min(minimumWholeRadiatorExposure,wholeExposure);assert.ok(wholeExposure>.78,'Whole station retains a conservative normal-ray exposure bound on both panel faces');
    const covered=box(V(p.min.x,-900,p.min.z),V(p.max.x,-850,p.max.z));assert.ok(projectedArea(covered,p)>=area-1e-6,'A cover blocking the complete radiator face fails the exposure bound');
  }
  for(const z of [3350,5850]){const brace=solidComponents(fs.find(p=>p.name===`radiator-brace-${s}-${z}`).geo)[0];assert.ok(materialContact(brace,arm)&&materialContact(brace,spine),'Diagonal stay has real end contacts');}
}
metrics.minimumAddedSupportRadiatorExposure=minimumRadiatorExposure;
metrics.minimumWholeStationRadiatorNormalExposure=minimumWholeRadiatorExposure;
const withoutSpines=[...oldFC,...fs.filter(p=>!p.name.startsWith('radiator-spine')).flatMap(p=>solidComponents(p.geo))];assert.ok(graph(withoutSpines,foundryRoot).disconnected>=4,'Removing longitudinal load spines disconnects original outer leaves');
const shiftedSpines=[...oldFC,...fs.flatMap(p=>solidComponents(p.geo,new THREE.Matrix4().makeTranslation(0,p.name.startsWith('radiator-spine')?-500:0,0)))];assert.ok(graph(shiftedSpines,foundryRoot).disconnected>=4,'Displaced long spines fail material support');
// Global Y extrema are invariant under the wheel's complete Y rotation. This
// separates all new triangles from every wheel phase, including hub and spokes.
const wheel=solidComponents(selene.wheel),wheelBottom=Math.min(...wheel.map(c=>c.bounds.min.y));
const newSC=ss.flatMap(p=>solidComponents(p.geo)),newFC=fs.flatMap(p=>solidComponents(p.geo));
const top=Math.max(...newSC.map(c=>c.bounds.max.y));metrics.seleneFullRotationGapMetres=wheelBottom-top;assert.ok(metrics.seleneFullRotationGapMetres>200);
const raisedCollar=solidComponents(ss[0].geo,new THREE.Matrix4().makeTranslation(2200,1600,0));assert.ok(raisedCollar.some(c=>wheel.some(w=>materialContact(c,w))),'A collar displaced into the wheel fails actual material clearance');
// The complete bay and approach prisms include their open mouths through the
// 30 km local approach. Containment-aware contact catches enclosed obstructions.
for(const x of [-4200,0,4200]){
  const volume=box(V(x-1200,-900,-30000),V(x+1200,600,1400));assert.ok(!fc.some(c=>materialContact(volume,c)),'Whole Foundry clears every point of the intake and approach volume');
  const obstruction=box(V(x-20,-850,-100),V(x+20,-800,100));assert.ok(materialContact(volume,obstruction),'A floating obstruction inside the approach is detected');
  const enclosing=box(V(x-2000,-2000,-40000),V(x+2000,2000,5000));assert.ok(materialContact(volume,enclosing),'An enclosing structure is also rejected');
}
metrics.foundryBayVerticalGapMetres=-900-Math.max(...newFC.filter(c=>Math.abs(c.bounds.getCenter(V()).x)<6000).map(c=>c.bounds.max.y));assert.ok(metrics.foundryBayVerticalGapMetres>=69);
const haloLane=box(V(-1100,-4600,-22800),V(1100,-3400,-21600));assert.ok(!newFC.some(c=>materialContact(haloLane,c)),'Complete slow-lane box stays clear');
// Production transforms, production craft geometry, analytic all-phase bounds.
const sim=new SpaceSim();sim.syncFromHours(17.5);sim.paused=true;
const runtime={scene:new THREE.Scene(),earthFixed:new THREE.Group(),sim,addBody(){}};runtime.scene.add(runtime.earthFixed);runtime.elevator=new Elevator({},{climbers:1});runtime.earthFixed.add(runtime.elevator.group);runtime.fleet=new Fleet(runtime);runtime.works=new WorkingStations(runtime);
function radius(g,origin=V()){const p=g.attributes.position;let r=0;for(let i=0;i<p.count;i++)r=Math.max(r,V().fromBufferAttribute(p,i).distanceTo(origin));return r;}
function distance(components,p){let d=Infinity;for(const c of components)for(const t of c.triangles)d=Math.min(d,t.closestPointToPoint(p,V()).distanceTo(p));return d;}
const tender=buildTender(620);let tenderRadius=radius(tender.geo);for(const a of tender.arms)tenderRadius=Math.max(tenderRadius,a.pivot.length()+radius(a.geo,a.pivot));
const relic=runtime.fleet.relic;tenderRadius=Math.max(tenderRadius,relic.position.length()+radius(relic.geometry));
const fullTenderRadius=tenderRadius/1000+Math.hypot(.06,.03,.06);let minimumTenderGap=Infinity,epochCentres;
for(const hours of [0,7,17.5]){
  sim.syncFromHours(hours);runtime.earthFixed.quaternion.copy(sim.earthQuat);runtime.fleet.update(sim,120,0,runtime);runtime.scene.updateMatrixWorld(true);
  const inverse=runtime.works.foundry.matrixWorld.clone().invert(),centres=runtime.fleet.tenders.map(t=>t.offset.clone().applyMatrix4(runtime.fleet.tenderGroup.matrixWorld).applyMatrix4(inverse));
  if(epochCentres)centres.forEach((c,i)=>assert.ok(c.distanceTo(epochCentres[i])<1e-8,'Foundry and tender mean frames co-rotate without an unbounded drift'));else epochCentres=centres;
  for(const centre of centres)minimumTenderGap=Math.min(minimumTenderGap,distance(fc,centre.clone().multiplyScalar(1000))/1000-fullTenderRadius);
}
assert.ok(minimumTenderGap>1.5,'Whole Foundry clears each full articulated tender sphere at every phase');metrics.continuousTenderGapKm=minimumTenderGap;metrics.tenderSweptRadiusKm=fullTenderRadius;
const tanker=runtime.fleet.movers.find(m=>m.name==='tanker'),c=tanker.c;
assert.ok(c.dA.y>=0&&c.dD.y>=0&&c.bulge.y>=0,'The production tanker voyage stays above the lower endpoint throughout all three analytic phases');
const tankerFloor=Math.min(c.hold.y,c.start.y)-radius(tanker.mesh.geometry)/1000;metrics.continuousSeleneVoyageGapKm=tankerFloor-Math.max(...sc.map(c=>c.bounds.max.y))/1000;assert.ok(metrics.continuousSeleneVoyageGapKm>1);
// New solids fit the existing draw bounds at both independent construction scales.
for(const [name,data,limit]of[['Selene',selene,6000],['Foundry',foundry,28000]]){const bound=Math.max(...solidComponents(data.geo).flatMap(c=>c.vertices.map(v=>v.length())));assert.ok(bound<limit,`${name} existing culling radius contains actual material`);metrics[`${name.toLowerCase()}RadiusMetres`]=bound;}
const scaled=buildRefinery(.001);assert.equal(graph(solidComponents(scaled.geo,new THREE.Matrix4().makeScale(1000,1000,1000)),seleneRoot).disconnected,0,'Refinery scale parameter preserves its new connections');
console.log(JSON.stringify(metrics));console.log('ORBITAL_SUPPORTS_VERIFIED');
