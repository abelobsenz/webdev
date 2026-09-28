import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildHillCountry } from '../src/world/hillCountry.js';
import { buildRimForecourts } from '../src/world/rimForecourts.js';
import { renderedHeight } from '../src/world/outerCities.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { TOWERS } from '../src/world/layout.js';
import { buildTowers } from '../src/world/towers.js';
import { buildInfrastructure } from '../src/world/infrastructure.js';
import { wardBridgePaths, wardHeight } from '../src/world/metro.js';
import { planCity } from '../src/world/urban.js';
import { urbanMask } from '../src/world/world.js';
import { buildBuildings } from '../src/world/buildings.js';
import { auditGeometry } from './geometry-audit.mjs';

const auditOnly=process.argv.includes('--audit-only'),hillOnly=process.argv.includes('--hill-only'),rimOnly=process.argv.includes('--rim-only');
const errors=[],counts={},examples={};
function check(ok,kind,detail){if(!ok){const key=detail?.kind?`${kind}/${detail.kind}`:kind;counts[key]=(counts[key]||0)+1;if(!examples[key])examples[key]=detail;if(errors.length<30)errors.push(`${kind}: ${JSON.stringify(detail)}`);}}
// This independent projected-triangle index reads the emitted material faces.
// The signed vertical intersections distinguish a closed solid from a roof or
// a passage below an arch. No production route collision helper is called.
function materialColumns(meshes,size=24,upwardOnly=false){
  const cells=new Map(),triangles=[];
  const add=m=>{if(!m?.geometry)return;m.updateMatrixWorld?.(true);const g=m.geometry,p=g.attributes.position,ix=g.index;
    for(let i=0;i<(ix?.count??p.count);i+=3){const q=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,ix?ix.getX(i+k):i+k));if(m.matrixWorld)q.forEach(v=>v.applyMatrix4(m.matrixWorld));
      const dx1=q[1].x-q[0].x,dz1=q[1].z-q[0].z,dx2=q[2].x-q[0].x,dz2=q[2].z-q[0].z,det=dx1*dz2-dz1*dx2;if(Math.abs(det)<1e-10||(upwardOnly&&det>0))continue;
      const t=[q[0].x,q[0].z,q[0].y,dx1,dz1,q[1].y-q[0].y,dx2,dz2,q[2].y-q[0].y,det,-Math.sign(det)],id=triangles.push(t)-1;
      for(let x=Math.floor(Math.min(...q.map(v=>v.x))/size);x<=Math.floor(Math.max(...q.map(v=>v.x))/size);x++)for(let z=Math.floor(Math.min(...q.map(v=>v.z))/size);z<=Math.floor(Math.max(...q.map(v=>v.z))/size);z++){const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);}
    }
  }
  for(const m of meshes)add(m);
  const hits=(x,z,tolerant=true)=>{x+=.000021;z+=.000009;const h=[];for(const id of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[]){const t=triangles[id],dx=x-t[0],dz=z-t[1],u=(dx*t[7]-dz*t[6])/t[9],v=(dz*t[3]-dx*t[4])/t[9],area=Math.abs(t[9]),epsilon=tolerant?.002:0,eu=epsilon*Math.hypot(t[6],t[7])/area,ev=epsilon*Math.hypot(t[3],t[4])/area,ew=epsilon*Math.hypot(t[6]-t[3],t[7]-t[4])/area;if(u>=-eu&&v>=-ev&&u+v<=1+ew)h.push([t[2]+u*t[5]+v*t[8],t[10]]);}return h;};
  return {
    support(x,z,y,tolerance=.3){let value=null;for(const [h,sign]of hits(x,z))if(sign>0&&Math.abs(h-y)<tolerance&&(value===null||h>value))value=h;return value;},
    blocked(x,z,y,height=2){let depth=0,last=Infinity;for(const [h,sign]of hits(x,z,false).sort((a,b)=>b[0]-a[0])){if(depth>0&&Math.min(last,y+height)>Math.max(h,y+.25)+.03)return true;depth+=sign;last=h;}return false;},
    add,hits,triangles:triangles.length,
  };
}
const control=new THREE.Mesh(new THREE.BoxGeometry(4,4,4).translate(0,2,0));
const columnControl=materialColumns([control]);
assert.equal(columnControl.support(0,0,4),4);
assert.equal(columnControl.support(0,0,10),null,'detached walking surface control');
assert.equal(columnControl.blocked(0,0,0),true,'solid blocking a passage control');
assert.equal(columnControl.blocked(5,0,0),false);
const jumpControl=materialColumns([{geometry:new THREE.BoxGeometry(2,.3,2).translate(-1,-.15,0)},{geometry:new THREE.BoxGeometry(2,1.4,2).translate(1,.7,0)}],24,true);
assert.ok(Math.abs(jumpControl.support(-.05,0,0,2)-jumpControl.support(.05,0,0,2))>1,'actual raised crossing discontinuity control');
const open=control.geometry.clone();open.setIndex(Array.from(open.index.array).slice(3));
assert.ok(auditGeometry(open).boundaryEdges>0,'missing-face control');

function routeGraph(roads,omitted=null){
  const nodes=[],ids=new Map(),parent=[],segments=[],cells=new Map(),ends=[],size=32;
  const pointKey=p=>[p.x,p.y,p.z].map(v=>Math.round(v*1000)).join(',');
  const add=p=>{const key=pointKey(p);if(ids.has(key))return ids.get(key);const n=nodes.push(p)-1;ids.set(key,n);parent.push(n);return n;};
  const find=n=>{while(parent[n]!==n){parent[n]=parent[parent[n]];n=parent[n];}return n;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[a]=b;};
  const trunks=[];
  for(const road of roads){if(road===omitted)continue;const ns=road.points.map(add);if(road.kind==='trunk')trunks.push(...ns);ends.push(ns[0],ns.at(-1));for(let k=1;k<ns.length;k++){
    const ai=ns[k-1],bi=ns[k],a=nodes[ai],b=nodes[bi];join(ai,bi);const id=segments.push([ai,bi,road.halfWidth])-1;
    for(let x=Math.floor(Math.min(a.x,b.x)/size);x<=Math.floor(Math.max(a.x,b.x)/size);x++)for(let z=Math.floor(Math.min(a.z,b.z)/size);z<=Math.floor(Math.max(a.z,b.z)/size);z++){const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);}
  }}
  let contacts=0;
  for(const n of ends){const p=nodes[n],i=Math.floor(p.x/size),j=Math.floor(p.z/size);for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)for(const id of cells.get(`${i+di},${j+dj}`)||[]){const [ai,bi]=segments[id];if(ai===n||bi===n)continue;const a=nodes[ai],b=nodes[bi],dx=b.x-a.x,dz=b.z-a.z,u=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(p.x-a.x-dx*u,p.z-a.z-dz*u)<.012&&Math.abs(p.y-a.y-(b.y-a.y)*u)<.24){join(n,ai);contacts++;}}}
  const trunkComponents=new Set(trunks.map(find));
  return{nodes:nodes.length,contacts,trunkComponents:trunkComponents.size,reaches(p){const n=ids.get(pointKey(p));if(n!==undefined&&trunkComponents.has(find(n)))return true;const i=Math.floor(p.x/size),j=Math.floor(p.z/size);for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)for(const id of cells.get(`${i+di},${j+dj}`)||[]){const [ai,bi,hw]=segments[id];if(!trunkComponents.has(find(ai)))continue;const a=nodes[ai],b=nodes[bi],dx=b.x-a.x,dz=b.z-a.z,u=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(p.x-a.x-dx*u,p.z-a.z-dz*u)<hw-.05&&Math.abs(p.y-a.y-(b.y-a.y)*u)<.24)return true;}return false;}};
}
let hillSummary=null,rimSummary=null;
if(!rimOnly){
  const componentTotals={count:0,triangles:0},plinths=new Map(),walkControlParts=[],walkSurfaces=materialColumns([],24,true);let firstSolid=null,walkControl=null;
  const hill=buildHillCountry(new THREE.Scene(),{onComponent:r=>{
    const a=auditGeometry(r.geometry,{tolerance:.0001});componentTotals.count++;componentTotals.triangles+=a.triangles;
    check(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges+a.degenerates+a.nonFinite+a.invalidNormals===0,'hill material topology',{kind:r.kind,site:r.site?.id,route:r.route?{id:r.route.id,kind:r.route.kind}:null,...a});
    check(a.signedVolume>0,'hill material winding',{kind:r.kind,site:r.site?.id,volume:a.signedVolume});
    if(r.route&&r.kind==='foundations')walkSurfaces.add({geometry:r.geometry});
    if(!firstSolid)firstSolid=r.geometry.clone();
    if(r.kind==='foundations'&&r.site&&!plinths.has(r.site.id))plinths.set(r.site.id,r.geometry.clone());
    if(r.route?.kind==='door-walk'){if(!walkControl)walkControl=r.route;if(r.route===walkControl)walkControlParts.push({geometry:r.geometry.clone()});}
  }});
  check(hill.entrances.length===hill.buildingSites.length,'every inhabited site has an entrance',{sites:hill.buildingSites.length,entrances:hill.entrances.length,failures:hill.buildingSites.filter(s=>s.accessFailure)});
  check(hill.villageCenters.length===hill.villages.length,'all village centres composed',hill.villageCenters.length);
  assert.equal(hill.shrines.length,7,'all seven original summit institutions remain');
  assert.ok(hill.shrines.some(s=>!s.observatory&&Math.hypot(s.x+2545.8673114329576,s.z+18944.588391557336)<.001),'the original monastery remains at its surveyed summit');
  check(hill.tris+hill.detailTris<4_200_000,'bounded hill geometry cost',hill.tris+hill.detailTris);
  let foundationSamples=0;
  for(const [id,g]of plinths){g.computeBoundingBox();const s=hill.buildingSites[id],lo=g.boundingBox.min.y,c=Math.cos(s.ang),a=Math.sin(s.ang),hl=s.L/2+.5,hw=s.W/2+.5;
    for(let u=-hl;u<=hl+.01;u+=Math.max(1,hl/8))for(let v=-hw;v<=hw+.01;v+=Math.max(1,hw/8)){const x=s.x+u*c-v*a,z=s.z+u*a+v*c;foundationSamples++;check(lo<=renderedHeight(x,z)+.08,'rural plinth foundation contact',{site:id,x,z,bottom:lo,ground:renderedHeight(x,z)});}
  }
  const plinthControl=plinths.get(0).clone().translate(0,100,0);plinthControl.computeBoundingBox();assert.ok(plinthControl.boundingBox.min.y>renderedHeight(hill.buildingSites[0].x,hill.buildingSites[0].z),'raised actual plinth control');
  const paving=materialColumns(hill.lod.flatMap(l=>[l.stone,l.detail]).filter(Boolean)),architecture=materialColumns(hill.lod.map(l=>l.arch).filter(Boolean));
  let roadSamples=0,thresholdSamples=0;
  for(const road of hill.roads)for(let k=1;k<road.points.length;k++){
    const a=road.points[k-1],b=road.points[k],length=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(length/(road.kind==='trunk'?6:1.5))),dx=(b.x-a.x)/(length||1),dz=(b.z-a.z)/(length||1);
    for(let j=0;j<=n;j++)for(const side of [-.7,0,.7]){const u=j/n,x=a.x+(b.x-a.x)*u+(a.sx+(b.sx-a.sx)*u)*road.halfWidth*side,z=a.z+(b.z-a.z)*u+(a.sz+(b.sz-a.sz)*u)*road.halfWidth*side,y=a.y+(b.y-a.y)*u;roadSamples++;
      const floor=walkSurfaces.support(x,z,y,.9),supported=floor!==null;
      check(supported,'actual rural paving support',{kind:road.kind,settlement:road.settlement,x,y,z,...(!supported?{hits:paving.hits(x,z),a,b}:{})});
      check(!architecture.blocked(x,z,y),'actual architecture blocks rural route',{kind:road.kind,settlement:road.settlement,x,y,z});
      if(supported)check(!paving.blocked(x,z,floor+.015),'actual rural wall or foliage blocks route',{kind:road.kind,settlement:road.settlement,x,y,z});
      check(renderedHeight(x,z)<=y+.25,'rural path buried by terrain',{kind:road.kind,settlement:road.settlement,x,y,z,ground:renderedHeight(x,z)});
    }
  }
  // At intersecting paved solids the walking surface is their visible upper
  // envelope, not an interpolated centreline below another intended tread.
  // Read only emitted route material as a floor (a wall or orchard crown cannot
  // become a floor), then independently check its longitudinal continuity.
  let continuitySamples=0;
  for(const r of hill.roads){let previous=null,previousNominal=null;for(let k=1;k<r.points.length;k++){const a=r.points[k-1],b=r.points[k],length=Math.hypot(a.x-b.x,a.z-b.z),n=Math.max(1,Math.ceil(length/.25));for(let j=0;j<=n;j++){
    const u=j/n,x=a.x+(b.x-a.x)*u,z=a.z+(b.z-a.z)*u,y=a.y+(b.y-a.y)*u,floor=walkSurfaces.support(x,z,y,.9);continuitySamples++;
    if(floor!==null&&previous!==null)check(Math.abs(floor-previous)<.24+Math.abs(y-previousNominal)*1.5,'actual route walking-surface continuity',{kind:r.kind,settlement:r.settlement,x,z,previous,floor,expectedChange:y-previousNominal});
    if(floor!==null){previous=floor;previousNominal=y;}
  }}}
  for(const e of hill.entrances){const distance=Math.hypot(e.foot.x-e.face.x,e.foot.z-e.face.z),n=Math.max(3,Math.ceil(distance/.2));
    check((distance-e.landing)/Math.max(1,e.steps)>=.29,'minimum rural tread run',{site:e.site,steps:e.steps,distance,landing:e.landing});
    let previous=paving.support(e.foot.x,e.foot.z,e.bottom,.3)??e.bottom;
    for(let k=0;k<n;k++){const u=k/n,x=e.foot.x+(e.face.x-e.foot.x)*u,z=e.foot.z+(e.face.z-e.foot.z)*u,progress=Math.min(1,u*distance/(distance-e.landing)),y=e.bottom+(e.top-e.bottom)*progress,support=paving.support(x,z,y,.3);thresholdSamples++;
      check(support!==null,'actual entrance tread support',{site:e.site,x,y,z});
      if(support!==null){check(Math.abs(support-previous)<.27,'actual threshold riser',{site:e.site,previous,support});previous=support;}
      if(u<.9)check(!architecture.blocked(x,z,Math.max(y,support??y)),'threshold architecture clearance',{site:e.site,x,y,z});
    }
  }
  const roots=hill.routes.map(r=>r.root);check(roots.every(p=>Number.isFinite(p.x+p.y+p.z)),'local routes terminate at real road samples',roots.length);
  check(hill.routes.length===hill.buildingSites.length,'route graph covers all inhabited sites',{routes:hill.routes.length,sites:hill.buildingSites.length});
  const graph=routeGraph(hill.roads);check(graph.trunkComponents===1,'whole rural trunk network connected',graph);
  for(const e of hill.entrances)check(graph.reaches({x:e.foot.x,y:e.bottom,z:e.foot.z}),'threshold reaches the rural road graph',{site:e.site,foot:e.foot});
  const leaf=hill.entrances.find(e=>Math.hypot(e.foot.x-walkControl.points.at(-1).x,e.foot.z-walkControl.points.at(-1).z)<.001);
  assert.ok(leaf,'missing-connection control targets an actual inhabited threshold');
  assert.equal(routeGraph(hill.roads,walkControl).reaches({x:leaf.foot.x,y:leaf.bottom,z:leaf.foot.z}),false,'removing the actual doorstep connection disconnects its threshold');
  const walkColumns=materialColumns(walkControlParts),sample=walkControl.points[Math.floor(walkControl.points.length/2)];assert.notEqual(walkColumns.support(sample.x,sample.z,sample.y,.3),null,'actual connection has material underfoot');assert.equal(materialColumns([]).support(sample.x,sample.z,sample.y,.3),null,'deleted connection material control');
  const opened=walkControlParts[0].geometry.clone();if(opened.index)opened.setIndex(Array.from(opened.index.array).slice(3));else for(const name of Object.keys(opened.attributes)){const a=opened.attributes[name];opened.setAttribute(name,new THREE.BufferAttribute(a.array.slice(a.itemSize*3),a.itemSize));}assert.ok(auditGeometry(opened,{tolerance:.0001}).boundaryEdges>0,'missing face from actual rural paving control');
  const first=hill.entrances[0];assert.ok(paving.support(first.foot.x,first.foot.z,first.bottom+80,.3)===null,'disconnected actual threshold control');
  assert.ok(architecture.blocked(hill.buildingSites[0].x,hill.buildingSites[0].z,hill.buildingSites[0].base),'route through real occupied belfry control');
  let treeChecks=0;
  for(const tree of hill.orchardTrees)for(const s of hill.buildingSites){if(Math.abs(tree.x-s.x)>s.L+s.W+5||Math.abs(tree.z-s.z)>s.L+s.W+5)continue;treeChecks++;const c=Math.cos(s.ang),a=Math.sin(s.ang),dx=tree.x-s.x,dz=tree.z-s.z;check(Math.abs(dx*c+dz*a)>s.L/2+2.3||Math.abs(-dx*a+dz*c)>s.W/2+2.3,'orchard crown intersects occupied building',{tree,site:s.id});}
  let fieldGateSamples=0;
  for(const f of hill.fieldSites){assert.ok(f.gate,'every enclosed field has an actual gateway');for(const depth of [-.2,.5,1.5,3.5,6])for(const side of [-1.1,0,1.1]){const g=f.gate,x=g.x+g.tx*side-g.dx*depth,z=g.z+g.tz*side-g.dz*depth,y=renderedHeight(x,z);fieldGateSamples++;check(!paving.blocked(x,z,y),'actual agricultural gateway blocked',{x,y,z,field:{x:f.x,z:f.z,kind:f.kind},depth,side});}}
  hillSummary={...componentTotals,houses:hill.houses,sites:hill.buildingSites.length,entrances:hill.entrances.length,centres:hill.villageCenters.length,fields:hill.fields,orchardTrees:hill.orchardTrees.length,foundationSamples,roadSamples,continuitySamples,thresholdSamples,treeChecks,fieldGateSamples,graphNodes:graph.nodes,graphContacts:graph.contacts,trunkComponents:graph.trunkComponents,persistent:hill.tris,detail:hill.detailTris};
  console.log('HILL_SURVEY '+JSON.stringify(hillSummary));
}
if(!hillOnly){
  const sampler=new HeightSampler(await buildTerrainData()),raw=(x,z)=>sampler.get(x,z),ground=(x,z)=>Math.max(0,raw(x,z),wardHeight(x,z)),scene=new THREE.Scene();
  const towers=buildTowers(TOWERS,ground,scene),infra=buildInfrastructure(scene,ground,raw),paths=wardBridgePaths(ground),heads=paths.filter(b=>b.head).map(b=>({x:b.head.x,z:b.head.z,r:Math.hypot(b.head.hw,b.head.hd)+6,end:'rim',head:b.head}));
  const plan=planCity({ground:raw,towers,promenades:[...infra.promenades,...paths.map(b=>b.path)],urbanMask,stations:[...infra.stations,...heads]});
  const avoid=(x,z,r)=>paths.some(b=>(b.head&&Math.hypot(b.head.x-x,b.head.z-z)<r+75)||b.path.slice(0,30).some(p=>Math.hypot(p.x-x,p.z-z)<r+22));
  let components=0,triangles=0;const featureParts=[];
  const rim=buildRimForecourts(new THREE.Scene(),towers,raw,avoid,{streets:plan.streets,lots:plan.lots,onComponent:r=>{
    components++;const a=auditGeometry(r.geometry,{tolerance:.0001});triangles+=a.triangles;
    check(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges+a.degenerates+a.nonFinite+a.invalidNormals===0,'rim material topology',{court:r.court,lod:r.lod,role:r.role,...a});
    check(a.signedVolume>0,'rim material winding',{court:r.court,role:r.role,volume:a.signedVolume});
    if(r.lod==='near')featureParts.push(r);
  }});
  const courts=materialColumns(rim.sets.map(s=>s.near));let passageSamples=0,arrivalSamples=0,rimFoundationSamples=0;
  for(const part of featureParts)if(['foundation','outer-walk','entrance'].includes(part.role)){
    const p=part.geometry.attributes.position,n=part.geometry.attributes.normal;
    for(let k=0;k<p.count;k++)if(n.getY(k)<-.4){const x=p.getX(k),y=p.getY(k),z=p.getZ(k);rimFoundationSamples++;check(y<=raw(x,z)+.1,'actual rim foundation contact',{court:part.court,role:part.role,x,y,z,ground:raw(x,z)});}
  }
  for(const s of rim.sets){check(s.entrances.length>0,'every court has a traversable entrance',{x:s.center.x,z:s.center.z});check(s.arrivals.length>0,'every court joins an actual street',{x:s.center.x,z:s.center.z});
    for(const e of s.entrances){
      const R=s.radius-4,n=Math.ceil(e.length/.2);
      for(let k=1;k<n;k++){const d=e.length*k/n,a=e.start+e.direction*d/R,y=e.bottom+e.rise*Math.min(e.steps,Math.max(0,Math.ceil((d-5)/.42)))/e.steps;for(const off of [-.8,0,.8]){const x=s.center.x+Math.cos(a)*(R+off),z=s.center.z+Math.sin(a)*(R+off);passageSamples++;
        check(courts.support(x,z,y,.25)!==null,'rim actual tread support',{court:s.center.toArray(),x,y,z});check(!courts.blocked(x,z,y),'rim actual stair passage blocked',{court:s.center.toArray(),x,y,z});check(raw(x,z)<y+.2,'rim stair buried',{court:s.center.toArray(),x,y,z,ground:raw(x,z)});
      }}
      const a=e.a,outR=s.walkRadius,length=outR-R,m=Math.ceil(length/.2);
      for(let k=0;k<=m;k++){const u=k/m,r=outR+(R-outR)*u,x=s.center.x+Math.cos(a)*r,z=s.center.z+Math.sin(a)*r,y=e.arrivalY+(e.bottom-e.arrivalY)*Math.min(1,(outR-r)/(outR-s.radius-.03));check(courts.support(x,z,y,.3)!==null,'rim radial entrance support',{x,y,z});check(!courts.blocked(x,z,y),'rim parapet opening blocked',{x,y,z});}
    }
    for(const e of s.arrivals){
      check(courts.support(e.street.x,e.street.z,raw(e.street.x,e.street.z)+.14,.25)!==null,'actual street-to-rim elevation contact',e.street);
      const length=Math.hypot(e.street.x-e.walk.x,e.street.z-e.walk.z),n=Math.max(1,Math.ceil(length/.4));let previous=null;
      for(let k=0;k<=n;k++){const u=k/n,x=e.street.x+(e.walk.x-e.street.x)*u,z=e.street.z+(e.walk.z-e.street.z)*u,y=raw(x,z)+.14,floor=courts.support(x,z,y,1.5);arrivalSamples++;check(floor!==null,'rim receiving path support',{x,y,z});if(floor!==null){check(!courts.blocked(x,z,floor),'rim receiving path passage',{x,y:floor,z});if(previous!==null)check(Math.abs(floor-previous)<.45,'rim receiving path continuity',{x,z,previous,floor});previous=floor;}}
    }
  }
  const rimLots=plan.lots.filter(l=>rim.sets.some(s=>Math.hypot(l.x-s.center.x,l.z-s.center.z)<s.radius+40));
  const neighbors=buildBuildings(new THREE.Scene(),{lots:rimLots,streets:[],squares:[],districts:[]},raw,{lowrise:1});
  // Actual nearby building meshes, including front steps and cornices, must
  // leave the new perimeter walks and their receiving paths clear.
  const neighborMeshes=neighbors.chunks.map(l=>l.near);check(neighborMeshes.length>0,'actual neighboring building geometry present',neighborMeshes.length);
  const buildingColumns=materialColumns(neighborMeshes);let neighborSamples=0;
  for(const s of rim.sets){for(let k=0,n=Math.ceil(Math.PI*2*s.walkRadius);k<n;k++){const a=k/n*Math.PI*2;for(const off of [-.8,0,.8]){const x=s.center.x+Math.cos(a)*(s.walkRadius+off),z=s.center.z+Math.sin(a)*(s.walkRadius+off),y=raw(x,z)+.2;neighborSamples++;check(!buildingColumns.blocked(x,z,y),'rim walk intersects actual nearby building',{x,y,z});}}
    for(const e of s.arrivals){const length=Math.hypot(e.street.x-e.walk.x,e.street.z-e.walk.z),n=Math.max(1,Math.ceil(length/.6)),dx=(e.walk.x-e.street.x)/(length||1),dz=(e.walk.z-e.street.z)/(length||1);for(let k=0;k<=n;k++)for(const side of [-1,0,1]){const u=k/n,x=e.street.x+(e.walk.x-e.street.x)*u-dz*side,z=e.street.z+(e.walk.z-e.street.z)*u+dx*side,y=raw(x,z)+.2;neighborSamples++;check(!buildingColumns.blocked(x,z,y),'rim approach intersects actual nearby building',{x,y,z});}}
  }
  rimSummary={courts:rim.sets.length,components,triangles,passageSamples,arrivalSamples,neighborSamples,rimFoundationSamples,courtsSummary:rim.sets.map(s=>({x:s.center.x,z:s.center.z,entrances:s.entrances.length,arrivals:s.arrivals.length,triangles:s.near.geometry.index.count/3}))};
  console.log('RIM_SURVEY '+JSON.stringify(rimSummary));
}
console.log('COUNTRYSIDE_ERRORS '+JSON.stringify({counts,examples}));
if(!auditOnly)assert.equal(errors.length,0,errors.join('\n'));
if(!errors.length&&!hillOnly&&!rimOnly)console.log('COUNTRYSIDE_VERIFIED');
