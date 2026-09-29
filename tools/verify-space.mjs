import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditGeometry } from './geometry-audit.mjs';
import { CB,CK,buildSkiff,buildTender,buildLiner,buildRefinery } from '../src/craft/craftGeometry.js';
import { buildShuttle,buildTug,buildFreighter,buildCourier,buildClimber } from '../src/craft/craftClasses.js';
import { buildPortStation,buildCounterworks,stationFrame } from '../src/space/stations.js';
import { buildHarbour } from '../src/space/harbour.js';
import { buildCounterweightRock } from '../src/space/counterweightRock.js';
import { buildCollector,Hearth } from '../src/space/hearth.js';
import { beam,KIND,GARDEN_SURFACE } from '../src/space/hull.js';
import { buildBand,Moon } from '../src/space/moon.js';
import { Rings } from '../src/space/rings.js';
import { buildLunarPort,buildLunarRingDistricts,placedHalls } from '../src/space/lunarPort.js';
import { buildFoundry,buildSolarCollector,WorkingStations } from '../src/space/workingStations.js';
import { Fleet,voyage,shuttleRun } from '../src/space/fleet.js';
import { Elevator } from '../src/space/elevator.js';
import { SpaceSim,R_EARTH,MERIDIAN_LON,bodyDir,MOON_DIST,cityToBody } from '../src/space/sim.js';
import { SpaceMode } from '../src/space/index.js';
import { createRibbonMaterial } from '../src/space/lines.js';
import { Traffic } from '../src/space/traffic.js';
import { buildEmbarkationTerrace,buildLunarServiceCourt } from '../src/space/interfaces.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z),results=[];
function closed(name,g,tolerance=.001) {
  const a=auditGeometry(g,{tolerance});
  for(const k of ['boundaryEdges','nonManifoldEdges','inconsistentEdges','degenerates','nonFinite','invalidNormals']) assert.equal(a[k],0,`${name}: ${k}=${a[k]}`);
  assert.ok(a.signedVolume>0,`${name}: outward oriented positive volume`);
  results.push({name,triangles:a.triangles});return g;
}
// Positive controls prove the checker can see an open sheet and a missing end cap.
assert.ok(auditGeometry(new THREE.PlaneGeometry(1,1)).boundaryEdges>0);
const open=new THREE.CylinderGeometry(1,1,2,12,1,true);
assert.ok(auditGeometry(open).boundaryEdges>0);
const capZero=new CB();capZero.loft([{z:0,pts:[[-1,-1],[1,-1],[1,1],[-1,1]]},{z:2,pts:[[-1,-1],[1,-1],[1,1],[-1,1]]}],CK.HULL,{capStart:CK.GLASS,capEnd:CK.GLASS});
closed('glass-cap-material-zero',capZero.geometry(),1e-5);
// Cap facade coordinates must be affine over the entire fan, including an offset
// and asymmetric section. A zero-UV centre used to pull stripes toward a false origin.
for(const pts of [[[-40,10],[70,10],[56,61],[2,79],[-47,35]],[[-52,0],[52,0],[52,20],[32,41],[-18,50],[-52,20]]]) {
  const b=new CB();b.loft([{z:-33,pts},{z:47,pts}],CK.CONSERVATORY,{capStart:CK.CONSERVATORY,capEnd:CK.CONSERVATORY});
  const g=b.geometry(),p=g.getAttribute('position'),n=g.getAttribute('normal'),f=g.getAttribute('aFacade');
  const capIndices=Array.from({length:p.count},(_,i)=>i).filter(i=>Math.abs(n.getZ(i))>.999);
  const affine=()=>capIndices.every(i=>Math.abs(p.getX(i)-f.getX(i))<1e-5&&Math.abs(p.getY(i)-f.getY(i))<1e-5);
  assert.ok(capIndices.length>pts.length*2&&affine(),'Offset loft caps preserve their actual planar coordinates on both ends');
  const center=capIndices[0],saved=[f.getX(center),f.getY(center)];f.setXY(center,0,0);
  assert.ok(!affine(),'Positive control: original zero-UV cap centre distorts the affine facade');f.setXY(center,...saved);
  assert.ok(affine());
}


for(const [name,builder] of Object.entries({skiff:buildSkiff,shuttle:buildShuttle,tug:buildTug,freighter:buildFreighter,courier:buildCourier,climber:buildClimber,liner:buildLiner})) closed(name,builder().geo);
const tender=buildTender(620);closed('tender',tender.geo);tender.arms.forEach((p,i)=>closed(`tender-arm-${i}`,p.geo));
const ports=[buildPortStation(),buildPortStation({junction:true})];
ports.forEach((p,i)=>{closed(`port-${i}`,p.geo);closed(`port-ships-${i}`,p.ships);});
const harbour=buildHarbour();for(const k of ['body','wingGeo','shipsBigGeo','shipsSmallGeo'])closed(`harbour-${k}`,harbour[k]);
harbour.rings.forEach((r,i)=>closed(`harbour-ring-${i}`,r.geo));
const refinery=buildRefinery();closed('selene-body',refinery.geo);closed('selene-wheel',refinery.wheel);
const rock=buildCounterweightRock();closed('counterweight-rock',rock.geo,1e-5);
const counter=buildCounterworks({surfaceRadius:rock.surfaceRadius});closed('counterweight-works',counter.geo);
closed('hearth-collector',buildCollector(),1e-5);
const hearth=new Hearth({},{bhSteps:110,bhScale:.6});
closed('hearth-connected-ring',hearth.stations.children[14].geometry,1e-4);
closed('hearth-refuge-fixed',hearth.refugeFixed.geometry,1e-5);
hearth.refugeRotors.forEach((m,i)=>closed(`hearth-refuge-rotor-${i}`,m.geometry,1e-5));
const foundry=buildFoundry(),solar=buildSolarCollector(),lunar=buildLunarPort();
closed('reclamation-works',foundry.geo);closed('solar-collector',solar.geo);closed('lunar-port',lunar.geo);
const terrace=buildEmbarkationTerrace(),court=buildLunarServiceCourt();
closed('harbour-embarkation-terrace',terrace.geo);closed('lunar-service-court',court.geo);
closed('lunar-ring',buildBand(2117,11,1800));
const lunarDistricts=buildLunarRingDistricts();closed('lunar-ring-districts',lunarDistricts.geo);closed('lunar-ring-hall',lunarDistricts.hallNear);closed('lunar-ring-hall-far',lunarDistricts.hallFar);
for(const d of lunarDistricts.districts) {
  assert.ok(Math.abs(Math.hypot(d.base.x,d.base.z)-2116990)<.01,'Lunar hall foundation rests ten metres inside the ring slab');
  assert.ok(Math.abs(d.base.y)>3300,'District halls keep the transit corridor clear');
}

const rings=new Rings({},{ringSegs:.75});
rings.meshes.forEach((m,i)=>closed(`earth-ring-${rings.defs[i].name}`,m.geometry));

const probeMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
function probe(g){const m=new THREE.Mesh(g,probeMaterial);m.updateMatrixWorld();return m;}
const rockProbe=probe(rock.geo);
const ray=new THREE.Raycaster();
// Sample the real coaxial shells: the rotating transfer collars retain a genuine bore
// and a positive radial magnetic gap around the fixed spindle and field housings.
const refugeFixedProbe=probe(hearth.refugeFixed.geometry);
for(const garden of hearth.refugeData.galleries) {
  const g=hearth.refugeData.rotors[garden.rotor].geo,roofProbe=probe(g);
  ray.set(garden.center.clone().add(V(0,2,0)),V(0,-1,0));ray.far=3;
  const hit=ray.intersectObject(roofProbe,false)[0];assert.ok(hit,'Refuge garden remains beneath a real pressure shell');
  const kinds=g.getAttribute('aKind'),faceIndices=[hit.face.a,hit.face.b,hit.face.c];
  const isGarden=()=>faceIndices.every(i=>kinds.getX(i)===KIND.GARDEN);
  assert.ok(isGarden(),'Actual refuge roof triangles use enclosed garden material');
  kinds.setX(hit.face.a,KIND.PANEL);assert.ok(!isGarden(),'Positive control: a photovoltaic roof triangle fails the garden attribute check');kinds.setX(hit.face.a,KIND.GARDEN);
  assert.ok(hit.face.normal.y>.9,'Closed garden roof normals face away from the enclosed volume');
  assert.ok(Math.abs(hit.point.y-.8125)<1e-4,'Material pass preserves the actual original garden shell height');
}
// Inspect the actual closed sphere's native UVs, including coincident seam and pole
// vertices. The whole longitude carries integer repeats of both glazing and courts.
const gardenGeo=hearth.refugeData.rotors[0].geo,gardenUV=gardenGeo.getAttribute('aSurface'),gardenPos=gardenGeo.getAttribute('position'),gardenKind=gardenGeo.getAttribute('aKind');
const seamGroups=new Map();let gardenUvArea=0;
for(let i=0;i<gardenPos.count;i++)if(gardenKind.getX(i)===KIND.GARDEN) {
  assert.ok(Number.isFinite(gardenUV.getX(i))&&Number.isFinite(gardenUV.getY(i)),'Native garden UVs are finite at seams and poles');
  const key=[gardenPos.getX(i),gardenPos.getY(i),gardenPos.getZ(i)].map(n=>Math.round(n*1e5)).join(',');
  const group=seamGroups.get(key)||[];group.push(i);seamGroups.set(key,group);
}
for(let i=0;i<gardenPos.count;i+=3)if(gardenKind.getX(i)===KIND.GARDEN) {
  const a=new THREE.Vector2().fromBufferAttribute(gardenUV,i),b=new THREE.Vector2().fromBufferAttribute(gardenUV,i+1),c=new THREE.Vector2().fromBufferAttribute(gardenUV,i+2);
  const area=Math.abs(b.sub(a).cross(c.sub(a)));assert.ok(area>1e-7,'Even pole triangles retain a finite native facade derivative');gardenUvArea+=area;
}
let checkedGardenSeams=0;
for(const group of seamGroups.values()) {
  const us=group.map(i=>gardenUV.getX(i)),du=Math.max(...us)-Math.min(...us);
  if(Math.abs(du-1)>1e-6)continue;
  for(const period of [GARDEN_SURFACE.pane,GARDEN_SURFACE.courtU]) {
    const repeats=du*GARDEN_SURFACE.circumference/period;
    assert.ok(Math.abs(repeats-Math.round(repeats))<1e-6,'Both banks of the native longitude seam repeat the same material phase');
    const shifted=(du+.0007)*GARDEN_SURFACE.circumference/period;assert.ok(Math.abs(shifted-Math.round(shifted))>.01,'Positive control: an offset longitude tears the material seam');
  }
  checkedGardenSeams++;
}
assert.ok(checkedGardenSeams>20&&gardenUvArea>1,'The test actually sampled multiple generated garden seams and pole triangles');
let refugeBearingGap=Infinity;
for(const [i,rotor] of hearth.refugeData.rotors.entries()) {
  const rotorProbe=probe(rotor.geo);
  ray.set(V(0,-3,0),V(0,1,0));ray.far=6;
  assert.equal(ray.intersectObject(rotorProbe,false).length,0,'Refuge transfer collar preserves its actual axial bore');
  for(let k=0;k<192;k++) {
    const direction=V(Math.cos(k/192*Math.PI*2),0,Math.sin(k/192*Math.PI*2));
    ray.set(V(0,0,0),direction);ray.far=2.2;
    const rotating=ray.intersectObject(rotorProbe,false)[0];assert.ok(rotating);
    ray.set(V(0,rotor.y,0),direction);
    const fixed=ray.intersectObject(refugeFixedProbe,false);assert.ok(fixed.length);
    refugeBearingGap=Math.min(refugeBearingGap,rotating.distance-Math.max(...fixed.map(h=>h.distance)));
  }
  assert.ok(Math.abs(rotor.omega**2*rotor.floorRadius*1000-9.81)<1e-12,'Actual habitat angular speed produces 1 g at the outer occupied rim');
}
assert.ok(refugeBearingGap>.045,'Refuge moving and fixed bearing surfaces retain their measured magnetic gap');
ray.far=Infinity;
// Sample real lunar hall hulls against the faceted ring, rather than trusting their labels.
const lunarDistrictProbe=probe(placedHalls(lunarDistricts,[0,376,766,1234])),lunarBandProbe=probe(buildBand(2117,11,1800));
let lunarFoundationEmbed=Infinity;
for(const i of [0,376,766,1234]) {
  const d=lunarDistricts.districts[i],up=d.center.clone().setY(0).normalize();
  ray.set(up.clone().multiplyScalar(2119000).setY(d.center.y),up.clone().negate());ray.far=4000;
  const hallHits=ray.intersectObject(lunarDistrictProbe,false);assert.ok(hallHits.length>1,'Lunar hall has a closed actual hull');
  const hallBase=Math.min(...hallHits.map(h=>Math.hypot(h.point.x,h.point.z)));
  ray.set(up.clone().multiplyScalar(2119).setY(d.center.y*.001),up.clone().negate());ray.far=4;
  const ringHits=ray.intersectObject(lunarBandProbe,false);assert.ok(ringHits.length>1);
  const ringTop=Math.hypot(ringHits[0].point.x,ringHits[0].point.z)*1000;
  const embedded=ringTop-hallBase;lunarFoundationEmbed=Math.min(lunarFoundationEmbed,embedded);
  assert.ok(embedded>5&&embedded<12,'Lunar hall foundation is seated in the actual curved slab');
  assert.ok(hallBase+20>ringTop,'Positive control: moving a foundation up twenty metres creates a gap');
}
ray.far=Infinity;

let maxFootError=0;
for(const f of counter.footings) {
  ray.set(f.direction.clone().multiplyScalar(30),f.direction.clone().negate());
  const hit=ray.intersectObject(rockProbe,false)[0];assert.ok(hit);
  maxFootError=Math.max(maxFootError,hit.point.distanceTo(f.contact.clone().multiplyScalar(.001))*1000);
}
assert.ok(maxFootError<.02,`surveyed counterweight feet error ${maxFootError} m`);
const oldFootErrors=counter.mines.map(m=>Math.abs(m.surface.length()-9600));
assert.ok(Math.max(...oldFootErrors)>200,'positive control: old assumed sphere must fail the contact check');
let conveyorClearance=Infinity;
for(const belt of counter.conveyors) for(let j=0;j<=40;j++) {
  const p=belt.start.clone().lerp(belt.end,j/40),direction=p.clone().normalize();
  ray.set(direction.clone().multiplyScalar(30),direction.clone().negate());
  const hit=ray.intersectObject(rockProbe,false)[0];assert.ok(hit);
  conveyorClearance=Math.min(conveyorClearance,p.length()-hit.point.length()*1000-belt.radius);
}
assert.ok(conveyorClearance>500,`Counterweight conveyors clear actual rock by ${conveyorClearance} m`);

// Actual radiator vertices, rather than duplicated placement constants, define this gap.
const rp=refinery.geo.attributes.position,fac=refinery.geo.attributes.aFacade;
let radiatorTop=-Infinity;
for(let i=0;i<rp.count;i++) if(fac.getZ(i)===CK.RADIATOR) radiatorTop=Math.max(radiatorTop,rp.getY(i));
refinery.wheel.computeBoundingBox();
const wheelBottom=refinery.wheel.boundingBox.min.y;
assert.ok(wheelBottom-radiatorTop>250,`Selene radiator/wheel gap ${wheelBottom-radiatorTop} m`);
assert.ok(-40>wheelBottom,'positive control: old radiator upper edge intersects the wheel envelope');
for(let i=0;i<refinery.tanks.length;i++)for(let j=i+1;j<refinery.tanks.length;j++) {
  const a=refinery.tanks[i],b=refinery.tanks[j];
  assert.ok(a.center.distanceTo(b.center)>a.radius+b.radius+40,'Selene pressure tanks require separate shells and service clearance');
}

// Select the actual pier vertices passing the rotor band; all must remain outside it.
let minRotorGap=Infinity;
const p=ports[0].geo.attributes.position;
for(let i=0;i<p.count;i++) {
  const x=p.getX(i),y=p.getY(i),z=Math.abs(p.getZ(i));
  if(Math.abs(x)<3000&&z>15500&&z<18000) minRotorGap=Math.min(minRotorGap,Math.hypot(z-16672,y+1568)-1120);
}
assert.ok(minRotorGap>450,`Halo pier/rotor gap ${minRotorGap} m`);
assert.ok(Math.hypot(16672-16672,-560+1568)-1120<0,'positive control: old pier centre lies inside rotor');

// The Meridian tower passes through a real glazing opening; nearby glazing remains.
const roofProbe=probe(rings.roofs[0].geometry),junctionUp=bodyDir(0,MERIDIAN_LON),junctionWest=V().crossVectors(junctionUp,V(0,1,0)).normalize();
ray.set(junctionUp.clone().multiplyScalar(R_EARTH+630),junctionUp.clone().negate());ray.far=8;
assert.equal(ray.intersectObject(roofProbe,false).length,0,'Junction pressure collar needs a real opening in the vault');
ray.set(junctionUp.clone().multiplyScalar(R_EARTH+630).addScaledVector(junctionWest,4),junctionUp.clone().negate());
assert.ok(ray.intersectObject(roofProbe,false).length>0,'Positive control: the adjacent vault remains glazed');ray.far=Infinity;

// Test actual triangles against the three reserved receiving volumes.
const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),tri=new THREE.Triangle(a,b,c);
function intersectsInterior(g,box) {
  const pos=g.attributes.position,ix=g.index;
  for(let i=0;i<(ix?.count??pos.count);i+=3) {
    a.fromBufferAttribute(pos,ix?ix.getX(i):i);b.fromBufferAttribute(pos,ix?ix.getX(i+1):i+1);c.fromBufferAttribute(pos,ix?ix.getX(i+2):i+2);
    if(box.intersectsTriangle(tri)) return true;
  }
  return false;
}
for(const bay of foundry.bays) {
  const box=new THREE.Box3(bay.min.clone().addScalar(1),bay.max.clone().addScalar(-1));
  assert.ok(!intersectsInterior(foundry.geo,box),'Foundry receiving hall must contain no structural triangles');
  assert.ok(intersectsInterior(new THREE.BoxGeometry(100,100,100).translate((bay.min.x+bay.max.x)/2,0,0),box),'positive control: obstructed receiving hall detected');
}

// The foundry's gallery passes under the complete slow-lane envelope, including traffic jitter.
const northLane=new THREE.Box3(V(-1100,-4600,-22800),V(1100,-3400,-21600));
assert.ok(!intersectsInterior(foundry.geo,northLane),'Foundry access gallery must clear the active Halo traffic corridor');
const oldGallery=new CB();oldGallery.tube([V(0,-4760,-26000),V(0,-2900,-15500)],170,12,CK.HULL);
assert.ok(intersectsInterior(oldGallery.geometry(),northLane),'Positive control: original foundry gallery crossed the slow lane');

// Every collector is physically joined to the ring at a root and at its service hull.
const supportMesh=hearth.stations.children[14];
for(const m of hearth.collectorMounts) {
  assert.ok(Math.abs(m.root.length()-900)<1e-7);
  const local=m.mount.clone().applyMatrix4(m.collector.matrix.clone().invert());
  ray.set(local,V(.173,.841,.513).normalize());
  const hits=ray.intersectObject(probe(m.collector.geometry),false);
  assert.ok(hits.length>0&&hits[0].distance<2,'Collector support ends inside its actual service hull');
  const supportPositions=supportMesh.geometry.attributes.position;
  let nearest=Infinity;
  for(let i=0;i<supportPositions.count;i++) nearest=Math.min(nearest,V().fromBufferAttribute(supportPositions,i).distanceTo(m.mount));
  assert.ok(nearest<.56,'Generated support geometry must reach the collector mount');
}

// The sleeve and nozzle are genuine openings in closed material, not filled caps.
ray.set(V(0,-100,0),V(0,1,0));ray.far=200;
assert.equal(ray.intersectObject(probe(buildClimber().geo),false).length,0,'Climber tether bore must remain open');
ray.set(V(0,0,-590),V(0,0,1));ray.far=150;
assert.equal(ray.intersectObject(probe(buildFreighter().geo),false).length,0,'Freighter nozzle mouth must remain open');
ray.far=Infinity;

// Liner gangways are measured against the actual ship mesh in its berth transform.
const lm=probe(buildLiner(2400).geo);
lm.matrix.makeBasis(new THREE.Vector3().crossVectors(V(0,1,0),harbour.pier.fwd).normalize(),V(0,1,0),harbour.pier.fwd).setPosition(harbour.pier.pos);
lm.matrixAutoUpdate=false;lm.updateMatrixWorld(true);
for(const g of harbour.gangways) {
  ray.set(g.root,g.end.clone().sub(g.root).normalize());
  const hit=ray.intersectObject(lm,false)[0];assert.ok(hit);
  assert.ok(hit.point.distanceTo(g.contact)<.01);
  assert.ok(g.root.distanceTo(g.end)>hit.distance+7.9);
}

// Paused simulation still produces separated, visible real guide cars.
const sim=new SpaceSim();sim.syncFromHours(17.5);sim.paused=true;
const el=new Elevator({},{climbers:220});
// The terrace's six real support roots lie inside the existing pier gallery.
el.station.terrace.updateMatrix();
const terraceToHarbour=el.station.terrace.matrix.clone().premultiply(new THREE.Matrix4().makeScale(1000,1000,1000));
const harbourProbe=probe(harbour.body);
let terraceRootDepth=Infinity;
for(const s of terrace.supports) {
  const root=s.root.clone().applyMatrix4(terraceToHarbour);
  ray.set(root,V(0,1,0));const hits=ray.intersectObject(harbourProbe,false);assert.ok(hits.length);
  const depth=hits[0].distance;terraceRootDepth=Math.min(terraceRootDepth,depth);
  assert.ok(depth>70&&depth<110,'Terrace support roots penetrate the actual arm gallery by its radius');
  assert.ok(s.end.y+s.radius>-8,'Support heads enter the underside of the closed deck');
}
for(const data of [terrace,court]) {
  // Select the actual generated receiving component rather than the combined mesh:
  // otherwise the brace itself could falsely certify its own unsupported endpoint.
  for(const joint of data.attachmentJoints) {
    const component=new THREE.BufferGeometry().setAttribute('position',data.geo.getAttribute('position'));
    component.setIndex(Array.from(data.geo.index.array.slice(...joint.range)));
    const target=probe(component),direction=V(.173,.841,.513).normalize();
    const inside=p=>{ray.set(p,direction);ray.far=Infinity;const hits=ray.intersectObject(target,false),unique=hits.filter((h,i)=>i===0||h.distance-hits[i-1].distance>1e-5);return unique.length%2===1;};
    assert.ok(inside(joint.point),`${joint.label} enters its real receiving solid in all three axes`);
    for(const axis of [V(300,0,0),V(0,300,0),V(0,0,300)])assert.ok(!inside(joint.point.clone().add(axis)),`${joint.label}: displaced positive control is detached`);
    if(joint.oldOffset)assert.ok(!inside(joint.point.clone().add(joint.oldOffset)),`${joint.label}: original shortened brace endpoint missed the beam`);
  }
  const approach=new THREE.Box3(data.courierApproach.min,data.courierApproach.max);
  assert.ok(!intersectsInterior(data.geo,approach),'Courier launch and approach volume stays clear of the complete new architecture');
  assert.ok(intersectsInterior(new THREE.BoxGeometry(20,20,20).translate(...approach.getCenter(V()).toArray()),approach),'Positive control: a misplaced gantry obstructs the courier approach');
  for(const path of data.passengerPaths) {
    const volume=new THREE.Box3(path.min,path.max);
    assert.ok(!intersectsInterior(data.geo,volume),'Sealed passenger circulation preserves a clear walking volume');
    assert.ok(intersectsInterior(new THREE.BoxGeometry(4,4,4).translate(...volume.getCenter(V()).toArray()),volume),'Positive control: misplaced fixtures obstruct passenger circulation');
    const floorProbe=probe(data.geo),y=path.min.y-.1;
    for(const t of [.05,.25,.5,.75,.95]) {
      const p=path.min.clone().lerp(path.max,t).setY(y+1);
      ray.set(p,V(0,-1,0));ray.far=1.1;
      const floorHit=ray.intersectObject(floorProbe,false)[0];assert.ok(floorHit,'Every sampled circulation leg has an actual floor');
      assert.ok(Math.abs(floorHit.point.y-y)<.02,'Walking floors meet their halls and platforms without hidden steps');
    }
  }
  const mesh=probe(data.geo);
  const ship=probe(data.courier.geo);ship.matrix.copy(data.courier.matrix);ship.matrixAutoUpdate=false;ship.updateMatrixWorld(true);
  for(const f of data.feet) {
    ray.set(f.foot.clone().add(V(2,1,0)),V(0,-1,0));ray.far=2;
    const padHit=ray.intersectObject(mesh,false)[0];assert.ok(padHit,'Courier foot has a real landing pad below it');
    assert.ok(Math.abs(padHit.point.y-(f.foot.y-.16))<.01,'Courier landing foot sits directly on the actual pad');
    ray.set(f.anchor.clone().add(V(0,-.3,0)),V(0,1,0));ray.far=.4;
    const hullHit=ray.intersectObject(ship,false)[0];assert.ok(hullHit,'Courier landing gear reaches its actual hull');
    assert.ok(hullHit.point.distanceTo(f.anchor)<.01);
  }
  for(const garden of data.gardens||[])for(const plant of garden.plants) {
    ray.set(plant.clone().add(V(0,8,0)),V(0,1,0));ray.far=garden.h*1.2;
    const roof=ray.intersectObject(mesh,false)[0];assert.ok(roof&&roof.distance>10,'Every new garden canopy has an actual closed pressure roof well above its planted trees');
  }
}
ray.far=Infinity;
const lunarCourtRuntime=new Moon({});lunarCourtRuntime.court.updateMatrix();
let lunarCourtEmbed=Infinity;
for(const x of [-440,0,440])for(const z of [-290,0,290]) {
  const base=V(x,-10,z).applyMatrix4(lunarCourtRuntime.court.matrix),up=base.clone().setY(0).normalize();
  ray.set(base.clone().addScaledVector(up,.1),up.clone().negate());ray.far=.3;
  const hit=ray.intersectObject(lunarBandProbe,false)[0];assert.ok(hit);
  const embed=100-hit.distance*1000;lunarCourtEmbed=Math.min(lunarCourtEmbed,embed);
  assert.ok(embed>5&&embed<12,'Service court foundation is seated in the actual faceted ring slab');
}
ray.far=Infinity;
const throughLine=new THREE.Box3(V(-1400,80,-1120),V(1400,250,-980));
assert.ok(!intersectsInterior(court.geo,throughLine),'The siding leaves the through-line vehicle envelope above the guideway clear');
assert.ok(intersectsInterior(new THREE.BoxGeometry(40,60,40).translate(0,100,-1050),throughLine),'Positive control: a cabinet placed on the through line obstructs it');
const up=bodyDir(0,MERIDIAN_LON),guide=V().crossVectors(up,V(0,1,0)).normalize();
el.cars.schedule=[0,1,0,26700,-1,0];
sim.t=13350;sim.update();
const radius=R_EARTH+35786*.25;
const cam=up.clone().multiplyScalar(radius).addScaledVector(guide,1).applyQuaternion(sim.earthQuat);
el.cars.update(sim,0,0,{camera:{position:cam}});
const visible=el.cars.cars.filter(m=>m.visible);
assert.equal(visible.length,2);
assert.ok(visible[0].position.distanceTo(visible[1].position)>.2399,'Opposing climbers occupy distinct guide cables');

// Polar directions and non-unit radial inputs must still produce true rotation frames.
for(const up of [V(1,0,0),V(0,1,0),V(0,-1,0),V(0,0,-1),V(1,2,3)]) {
  const q=stationFrame(up),m=new THREE.Matrix4().makeRotationFromQuaternion(q);
  assert.ok(Math.abs(q.lengthSq()-1)<1e-12&&Math.abs(m.determinant()-1)<1e-12);
  assert.ok(V(0,1,0).applyQuaternion(q).distanceTo(up.clone().normalize())<1e-12);
}
assert.ok(Math.abs(cityToBody().determinant()-1)<1e-12);
for(const direction of [V(0,0,1),V(0,0,-1),V(1,0,0),V(.6,.35,-.2)]) {
  const lunarSim=new SpaceSim();lunarSim.syncFromHours(17.5,direction);
  for(let j=0;j<=32;j++) {
    lunarSim.t=j/32*29.530589*86400;lunarSim.update();
    assert.ok(Math.abs(lunarSim.moonPos.length()-MOON_DIST)<1e-7,'Polar lunar initialization preserves the full orbital radius');
    assert.ok(Math.abs(lunarSim.moonQuat.lengthSq()-1)<1e-12);
  }
}
assert.equal(V().crossVectors(V(0,1,0),V(0,1,0)).lengthSq(),0,'Positive control: the old polar tangent degenerates');

// Real scene assembly and per-frame transforms, including world coordinates near the Sun.
const runtime={scene:new THREE.Scene(),earthFixed:new THREE.Group(),bodies:[],camera:new THREE.PerspectiveCamera(),size:new THREE.Vector2(1280,720),sim,
  addBody(name,objects,center,radius,opts){this.bodies.push({name,objects,center,radius,...opts});}};
runtime.scene.add(runtime.earthFixed);runtime.elevator=el;runtime.earthFixed.add(el.group);
runtime.fleet=new Fleet(runtime);runtime.works=new WorkingStations(runtime);
runtime.moon=lunarCourtRuntime;runtime.scene.add(runtime.moon.group);runtime.moon.update(sim,120);
// The lunar air is drawn from within below its 229 km shell (the sky and the haze over the Landing
// and the highlands), from without above it: the shell must never vanish to an eye inside it.
{
  const cam=new THREE.PerspectiveCamera(50,16/9,.001,1e7),air=new Moon({camera:cam,size:V(1280,720,0)});
  for(const [alt,side] of [[.4,THREE.BackSide],[15,THREE.BackSide],[228,THREE.BackSide],[240,THREE.FrontSide],[7400,THREE.FrontSide]]) {
    cam.position.set(1737+alt,0,0).applyQuaternion(sim.moonQuat).add(sim.moonPos);cam.updateMatrixWorld();
    air.update(sim,120);assert.equal(air.atmo.material.side,side,`lunar air seen from ${alt} km draws its ${side===THREE.BackSide?'inner':'outer'} face`);
  }
}
runtime.earthFixed.quaternion.copy(sim.earthQuat);runtime.earthFixed.updateMatrixWorld(true);
runtime.fleet.update(sim,120,0,runtime);runtime.works.update(sim);runtime.scene.updateMatrixWorld(true);
const focusHarness={sim,targets:{},fleet:runtime.fleet};SpaceMode.prototype._defineTargets.call(focusHarness);
for(const [name,object] of [['harbourTerrace',el.station.terrace],['lunarCourt',runtime.moon.court],['liner',runtime.fleet.docked]]) {
  const target=focusHarness.targets[name],position=target.position(V()),frame=target.frame(new THREE.Quaternion());
  assert.ok(position.distanceTo(object.getWorldPosition(V()))<1e-7,`${name} focus remains attached to its actual authored module`);
  assert.ok(Math.abs(frame.dot(object.getWorldQuaternion(new THREE.Quaternion())))>1-1e-10,`${name} focus uses the correct right-handed construction frame`);
  assert.ok(Math.abs(frame.lengthSq()-1)<1e-12);
}
// The default liner focus must show the actual hull prominently from the clear
// outboard side, rather than letting the much larger pier dominate the composition.
const linerTarget=focusHarness.targets.liner,linerCenter=linerTarget.position(V()),linerFrame=linerTarget.frame(new THREE.Quaternion());
function linerView(az,el,dist) {
  const camera=new THREE.PerspectiveCamera(50,16/9,.001,1000);
  camera.position.copy(V(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)).multiplyScalar(dist).applyQuaternion(linerFrame).add(linerCenter));
  camera.up.copy(V(0,1,0).applyQuaternion(linerFrame));camera.lookAt(linerCenter);camera.updateMatrixWorld(true);
  const p=runtime.fleet.docked.geometry.getAttribute('position');let min=Infinity,max=-Infinity;
  for(let i=0;i<p.count;i++){const projected=V().fromBufferAttribute(p,i).applyMatrix4(runtime.fleet.docked.matrixWorld).project(camera);min=Math.min(min,projected.x);max=Math.max(max,projected.x);}
  return {camera,width:(max-min)/2,min,max};
}
const defaultLinerView=linerView(linerTarget.view.az,linerTarget.view.el,linerTarget.defaultDist);
assert.ok(defaultLinerView.width>.55&&defaultLinerView.min>-.95&&defaultLinerView.max<.95,'Default liner focus fills over half the frame without clipping the hull');
ray.set(defaultLinerView.camera.position,linerCenter.clone().sub(defaultLinerView.camera.position).normalize());ray.far=Infinity;
assert.equal(ray.intersectObject(el.harbour,true)[0].object,runtime.fleet.docked,'Liner focus has an unobstructed view of the real hull');
assert.ok(linerView(2.35,.2,5.2).width<.4,'Positive control: original foreshortened distant view lets the pier dominate');
// Every exposed moving focus frame is a proper rotation, including the former mirrored tender frame.
for(const name of ['liner','tenders','selene'])for(const t of [0,21600,86400,86400*29.5]) {
  const previous=sim.t;sim.t=t;sim.update();
  const q=new THREE.Quaternion();runtime.fleet.pose(name,sim,null,q);
  assert.ok(Math.abs(q.lengthSq()-1)<1e-10,`${name} focus quaternion is unit length at ${t}`);
  assert.ok(Math.abs(new THREE.Matrix4().makeRotationFromQuaternion(q).determinant()-1)<1e-10,`${name} focus frame is right handed`);
  sim.t=previous;sim.update();
}
const mirrored=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(-1,0,0),V(0,1,0),V(0,0,1)));
assert.ok(Math.abs(mirrored.lengthSq()-1)>.1,'Positive control: a mirrored basis corrupts a quaternion');
let runtimeBoundRatio=0;
for(const body of runtime.bodies) {
  const center=body.center(),vertex=V();let bound=0;
  for(const object of body.objects)object.traverse(mesh=>{
    if(!mesh.isMesh||mesh.material?.transparent)return;
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++)bound=Math.max(bound,vertex.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).distanceTo(center));
  });
  assert.ok(bound<body.radius,`${body.name} runtime geometry exceeds its depth body (${bound.toFixed(3)} >= ${body.radius})`);
  runtimeBoundRatio=Math.max(runtimeBoundRatio,bound/body.radius);
}
// Validate the actual nearest-hull orientation at a radial +X heading, where one fallback failed.
const traffic=new Traffic(runtime,rings,{traffic:200});
traffic.shipPosJS=(i,t,out)=>{out.set(10000+t,0,0);return i===0?1:0;};
traffic.updateHulls(120,V(10120,0,0));
const hullMatrix=new THREE.Matrix4();traffic.hullSets[0].getMatrixAt(0,hullMatrix);
assert.ok(Math.abs(hullMatrix.determinant()-1e-9)<1e-15,'Traffic hull orientation preserves kilometre scale at a radial heading');
let validRuntimeTransforms=0;
runtime.scene.traverse(object=>{
  validRuntimeTransforms++;
  assert.ok(Math.abs(object.quaternion.lengthSq()-1)<1e-9,'Every actual orbital object has a unit quaternion');
  assert.ok(object.scale.x>0&&object.scale.y>0&&object.scale.z>0,'Every actual orbital object has positive scale');
});

// A triangle BVH makes complete service-route checks affordable without simplifying away thin fins.
function meshTriangles(objects,frame) {
  const list=[],inv=frame.matrixWorld.clone().invert(),matrix=new THREE.Matrix4();
  for(const object of objects)object.traverse(mesh=>{
    if(!mesh.isMesh||mesh.material?.transparent)return;
    matrix.multiplyMatrices(inv,mesh.matrixWorld);
    const p=mesh.geometry.attributes.position,ix=mesh.geometry.index;
    for(let i=0;i<(ix?.count??p.count);i+=3)list.push(new THREE.Triangle(...[0,1,2].map(j=>V().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(matrix))));
  });return list;
}
function triangleTree(triangles) {
  const box=new THREE.Box3();
  for(const t of triangles){box.expandByPoint(t.a);box.expandByPoint(t.b);box.expandByPoint(t.c);}
  if(triangles.length<20)return{box,triangles};
  const size=box.getSize(V()),axis=size.x>size.y?(size.x>size.z?'x':'z'):(size.y>size.z?'y':'z');
  triangles.sort((a,b)=>a.a[axis]+a.b[axis]+a.c[axis]-b.a[axis]-b.b[axis]-b.c[axis]);
  const half=triangles.length>>1;return{box,left:triangleTree(triangles.slice(0,half)),right:triangleTree(triangles.slice(half))};
}
const nearestPoint=V();
function surfaceDistance(tree,p,best=Infinity) {
  if(tree.box.distanceToPoint(p)>best)return best;
  if(tree.triangles){for(const tri of tree.triangles){tri.closestPointToPoint(p,nearestPoint);best=Math.min(best,nearestPoint.distanceTo(p));}return best;}
  const [near,far]=tree.left.box.distanceToPoint(p)<tree.right.box.distanceToPoint(p)?[tree.left,tree.right]:[tree.right,tree.left];
  return surfaceDistance(far,p,surfaceDistance(near,p,best));
}
// A complete rotation fills an annular envelope. Bounding each actual static triangle
// in radius and height is conservative: it cannot miss a collision at an unsampled phase.
function cylindricalRange(triangle) {
  const p=[triangle.a,triangle.b,triangle.c],cross=p.map((a,i)=>a.x*p[(i+1)%3].z-a.z*p[(i+1)%3].x);
  const inside=Math.abs(cross.reduce((a,b)=>a+b,0))>1e-14&&(cross.every(x=>x>=0)||cross.every(x=>x<=0));
  // Vertical walls project to lines or points; explicitly handle those degenerate
  // 2D triangles instead of relying on a triangle closest-point division by area.
  const rMin=inside?0:Math.min(...p.map((a,i)=>{const b=p[(i+1)%3],x=b.x-a.x,z=b.z-a.z,l=x*x+z*z,t=l<1e-20?0:Math.max(0,Math.min(1,-(a.x*x+a.z*z)/l));return Math.hypot(a.x+x*t,a.z+z*t);}));
  return {rMin,rMax:Math.max(...p.map(p=>Math.hypot(p.x,p.z))),yMin:Math.min(triangle.a.y,triangle.b.y,triangle.c.y),yMax:Math.max(triangle.a.y,triangle.b.y,triangle.c.y)};
}
hearth.refuge.updateWorldMatrix(true,true);
const fixedRanges=meshTriangles([hearth.refugeFixed],hearth.refuge).map(cylindricalRange),refugeEnvelopes=[];
let refugeSweptGap=Infinity;
const envelopeGap=(a,b)=>Math.hypot(Math.max(a.rMin-b.rMax,b.rMin-a.rMax,0),Math.max(a.yMin-b.yMax,b.yMin-a.yMax,0));
for(const rotor of hearth.refugeRotors) {
  const ranges=meshTriangles([rotor],rotor).map(cylindricalRange);
  const envelope={rMin:Math.min(...ranges.map(r=>r.rMin)),rMax:Math.max(...ranges.map(r=>r.rMax)),yMin:Math.min(...ranges.map(r=>r.yMin))+rotor.position.y,yMax:Math.max(...ranges.map(r=>r.yMax))+rotor.position.y};
  refugeEnvelopes.push(envelope);
  for(const fixed of fixedRanges)refugeSweptGap=Math.min(refugeSweptGap,envelopeGap(fixed,envelope));
}
assert.ok(refugeSweptGap>.04,`Every actual fixed Refuge triangle clears both complete rotor sweeps by ${refugeSweptGap} km`);
const oldApproach=probe(beam(hearth.refugeApproach.path[0],V(0,0,0),.7,KIND.HAB,10));
assert.ok(meshTriangles([oldApproach],oldApproach).map(cylindricalRange).some(t=>envelopeGap(t,refugeEnvelopes[0])===0),'Positive control: the original gallery enters the lower wheel swept volume');
const lowerWheel=probe(hearth.refugeRotors[0].geometry);lowerWheel.position.y=-8;lowerWheel.updateMatrixWorld(true);
ray.set(hearth.refugeApproach.path[0],hearth.refugeApproach.path[0].clone().negate().normalize());ray.far=hearth.refugeApproach.path[0].length();
assert.ok(ray.intersectObject(lowerWheel,false).length>0,'The original gallery centreline crosses actual habitat triangles, not just a broad envelope');ray.far=Infinity;
for(const time of [0,60,120,1200]) {
  hearth.update(sim,time,0,runtime);
  for(const rotor of hearth.refugeRotors)assert.ok(Math.abs(rotor.rotation.y-(time*rotor.userData.omega*rotor.userData.dir)%(Math.PI*2))<1e-12&&Math.abs(rotor.quaternion.lengthSq()-1)<1e-12);
  assert.ok(Math.abs(hearth.refugeRotors[0].rotation.y+hearth.refugeRotors[1].rotation.y)<1e-12,'The two real habitat assemblies counter-rotate');
}
const station=el.station,serviceTree=triangleTree(meshTriangles([station.body,station.terrace,...station.rings,...station.wings.map(w=>w.pivot),station.shipsBig,station.shipsSmall,runtime.fleet.docked],el.harbour));
const workshop=probe(court.geo.clone().setIndex(Array.from(court.geo.index.array.slice(...court.workshopRange))));
const workshopTree=triangleTree(meshTriangles([workshop],workshop));
let workshopRailClearance=Infinity;
for(let j=1;j<court.siding.length;j++)for(let k=0;k<=20;k++) {
  const p=court.siding[j-1].clone().lerp(court.siding[j],k/20);
  workshopRailClearance=Math.min(workshopRailClearance,surfaceDistance(workshopTree,p)-45);
}
assert.ok(workshopRailClearance>50,'Actual workshop, access stair and coolant manifolds stay clear of the full siding guideway');
const oldCabinet=new THREE.Box3(V(-410,25,-256),V(-340,39,-234));
assert.ok(court.siding.some((p,i)=>i&&Array.from({length:21},(_,j)=>court.siding[i-1].clone().lerp(p,j/20)).some(v=>oldCabinet.distanceToPoint(v)<45)),'Positive control: the original traction cabinet intruded into the siding');
const serviceRouteClearances=[];
for(const [runIndex,run] of runtime.fleet.runs.entries()) {
  run.mesh.geometry.computeBoundingSphere();
  const bound=run.mesh.geometry.boundingSphere,radius=(bound.radius+bound.center.length())*.001;
  let gap=Infinity;
  for(let t=0;t<=2*(run.move+run.pause);t+=.5) {
    const p=V();shuttleRun(t,run,p,V());gap=Math.min(gap,surfaceDistance(serviceTree,p)-radius);
  }
  assert.ok(gap>.1,`Harbour service route ${runIndex} clears its actual structural and docked-ship triangles by ${gap} km`);
  serviceRouteClearances.push(gap);
}
// the original lower-tug route to arm 5's head, rebuilt explicitly (the live run now loads a keel rack)
const arm5=station.data.arms[5],armHead5=(extra)=>arm5.d.clone().multiplyScalar((arm5.L+650+extra)*.001).setY(arm5.y*.001);
const oldTugRoute={...runtime.fleet.runs[0],pts:[V(1.25,-6.1,.35),V(3.8,-5.2,1.7),armHead5(0).setY(arm5.y*.001-1.3),armHead5(150)]};
const oldTugAt=V();shuttleRun(43.5,oldTugRoute,oldTugAt,V());
assert.ok(surfaceDistance(serviceTree,oldTugAt)<.005,'Positive control: old tug centre passes through the actual radiator surface');
const foundryTree=triangleTree(meshTriangles([runtime.works.foundry],runtime.works.foundry)),toFoundry=runtime.works.foundry.matrixWorld.clone().invert();
let tenderFoundryClearance=Infinity;
for(let t=0;t<=600;t+=2) {
  runtime.fleet.update(sim,t,0,runtime);runtime.scene.updateMatrixWorld(true);
  for(const tender of runtime.fleet.tenders) {
    const centre=tender.mesh.getWorldPosition(V()).applyMatrix4(toFoundry);
    tenderFoundryClearance=Math.min(tenderFoundryClearance,surfaceDistance(foundryTree,centre)-.6);
  }
}
// the capture cradle (round 2) brings the third tender to 1.98 km of the foundry's surface: its 600 m
// envelope must still keep a kilometre clear
assert.ok(tenderFoundryClearance>1.0,`New foundry structure clears the tenders and their 600 m working envelopes (${tenderFoundryClearance.toFixed(2)} km)`);
runtime.fleet.update(sim,120,0,runtime);runtime.scene.updateMatrixWorld(true);

// A conservative cylinder encloses the actual finished Harbour, including its docked liner.
const invHarbour=el.harbour.matrixWorld.clone().invert(),localMatrix=new THREE.Matrix4(),v=V();
let stationRadial=0,stationTop=-Infinity;
el.harbour.traverse(mesh=>{
  if(!mesh.isMesh||mesh.material?.transparent)return;
  localMatrix.multiplyMatrices(invHarbour,mesh.matrixWorld);
  const p=mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(localMatrix);stationRadial=Math.max(stationRadial,Math.hypot(v.x,v.z));stationTop=Math.max(stationTop,v.y);}
});
let minVoyageClearance=Infinity;
for(const mover of runtime.fleet.movers.filter(m=>m.name==='freighter'||m.name==='approach')) {
  const p=mover.mesh.geometry.attributes.position;let shipRadius=0;
  for(let i=0;i<p.count;i++)shipRadius=Math.max(shipRadius,Math.hypot(p.getX(i),p.getY(i),p.getZ(i))*.001);
  for(let i=0;i<=400;i++) {
    const position=V(),forward=V();voyage(i/400,mover.c,position,forward);
    if(Math.hypot(position.x,position.z)<=stationRadial+shipRadius) {
      const gap=position.y-shipRadius-stationTop;minVoyageClearance=Math.min(minVoyageClearance,gap);
      assert.ok(gap>.25,`${mover.name} turnaround intersects the Harbour operating envelope`);
    }
  }
}

// Shared post state is exercised as a method, with a deliberately contaminated city frame.
const scalar=value=>({value}),vec=value=>({value});
const names=['uAO','uShaftDark','uShaftLit','uStreak','uDirt','uExposure','uTime','uSaturation','uContrast','uBloom','uFlare','uGlareFov','uGlareR','uGlareMask','uGhosts'];
const uniforms=Object.fromEntries(names.map(n=>[n,scalar(1)]));
Object.assign(uniforms,{uGain:vec(V()),uLift:vec(V()),uGlareUV:vec(new THREE.Vector2()),uGlare:vec(V()),uTanHalf:vec(new THREE.Vector2()),uOcc1:vec(new THREE.Vector4()),uOcc2:vec(new THREE.Vector4())});
const camera=new THREE.PerspectiveCamera(50,16/9,1,1e7);camera.position.set(10000,10000,10000);camera.updateMatrixWorld();
const pipeline={finalMat:{uniforms},downMat:{uniforms:{uThreshold:scalar(0),uKnee:scalar(0),uClamp:scalar(0)}},adaptMat:{uniforms:{uRange:scalar(0)}},renderBloom(){},renderExposure(){},renderRays(){},composite(){},shaftValid:true,aoValid:true};
SpaceMode.prototype._post.call({app:{pipeline,settings:{bloom:true}},camera,sim,realTime:120,exposure:1,size:new THREE.Vector2(1280,720),_autoExposure:()=>1,_sunGlare:()=>({uv:new THREE.Vector2(.5,.5),vis:0})},.016,null);
for(const n of ['uAO','uShaftDark','uShaftLit','uStreak','uDirt'])assert.equal(uniforms[n].value,0,`${n} must not sample stale city post buffers`);
assert.equal(pipeline.shaftValid,false);assert.equal(pipeline.aoValid,false);
assert.equal(createRibbonMaterial({frag:'void main(){gl_FragColor=vec4(1.0);}'}).side,THREE.DoubleSide,'Subpixel ring ribbons must survive camera-facing winding');

// Bounds of all authored geometry stay inside their registered render bodies.
for(const [name,g,limit,units] of [['counterweight',counter.geo,20,1000],['foundry',foundry.geo,28,1000],['solar',solar.geo,15.5,1000],['lunarport',lunar.geo,11.2,1000],['selene',refinery.geo,6,1000],['harbour',harbour.body,17,1000],['harbour-terrace',terrace.geo,terrace.radius,1000],['lunar-court',court.geo,court.radius,1000]]) {
  const pos=g.attributes.position;let max=0;
  for(let i=0;i<pos.count;i++)max=Math.max(max,Math.hypot(pos.getX(i),pos.getY(i),pos.getZ(i))/units);
  assert.ok(max<limit,`${name} ${max} km exceeds ${limit} km body radius`);
}
const total=results.reduce((s,r)=>s+r.triangles,0);
assert.ok(total<30_000_000,`All audited unique/generated structural geometry ${total} tris exceeds orbital budget`);
console.log(JSON.stringify({meshes:results.length,structuralTriangles:total,footContactErrorMetres:maxFootError,conveyorClearanceMetres:conveyorClearance,rotorClearanceMetres:minRotorGap,seleneWheelClearanceMetres:wheelBottom-radiatorTop,foundryClearBays:foundry.bays.length,collectorSupports:hearth.collectorMounts.length,lunarHalls:lunarDistricts.districts.length,lunarFoundationEmbedMetres:lunarFoundationEmbed,terraceRootEmbedMetres:terraceRootDepth,lunarCourtEmbedMetres:lunarCourtEmbed,interfaceWalkingVolumes:terrace.passengerPaths.length+court.passengerPaths.length,workshopRailClearanceMetres:workshopRailClearance,refugeBearingGapMetres:refugeBearingGap*1000,refugeSweptGapMetres:refugeSweptGap*1000,refugeRotationPeriodSeconds:Math.PI*2/hearth.refugeData.rotors[0].omega,gangwayLengthsMetres:harbour.gangways.map(g=>g.root.distanceTo(g.contact)),runtimeBoundRatio,validRuntimeTransforms,serviceRouteClearancesKm:serviceRouteClearances,tenderFoundryClearanceKm:tenderFoundryClearance,turnaroundClearanceKm:minVoyageClearance}));
console.log('SPACE_VERIFIED');
