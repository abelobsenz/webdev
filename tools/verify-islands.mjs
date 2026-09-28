import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSkyline, SKYLINE_KEEPOUT } from '../src/world/skyline.js';
import { renderedHeight, outerCities } from '../src/world/outerCities.js';
import { massifArrival } from '../src/world/massifTowns.js';
import { islandPrism, rectangle, pointSegmentDistance } from '../src/world/islandPlan.js';
import { planIslandTrees } from '../src/world/islandTrees.js';
import { SPECIES } from '../src/world/treeGeometry.js';
import { auditGeometry } from './geometry-audit.mjs';
import { auditSolids } from './island-kit-audit.mjs';

const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const topology=g=>auditGeometry(g,{tolerance:1e-4});
const valid=a=>a.boundaryEdges===0&&a.nonManifoldEdges===0&&a.inconsistentEdges===0&&a.degenerates===0&&a.nonFinite===0&&a.invalidNormals===0;

function hull(geometry){
  const p=geometry.getAttribute('position'),map=new Map();
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);map.set(`${x},${z}`,[x,z]);}
  const pts=[...map.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const a=[],b=[];for(const p of pts){while(a.length>1&&cross(a.at(-2),a.at(-1),p)<=0)a.pop();a.push(p);}
  for(const p of pts.slice().reverse()){while(b.length>1&&cross(b.at(-2),b.at(-1),p)<=0)b.pop();b.push(p);}return [...a.slice(0,-1),...b.slice(0,-1)];
}
function foundationSupport(geometry){
  const q=hull(geometry),p=geometry.attributes.position;let bottom=Infinity,top=-Infinity;
  for(let i=0;i<p.count;i++){bottom=Math.min(bottom,p.getY(i));top=Math.max(top,p.getY(i));}
  const centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]);let air=0,buried=0;
  const sample=(x,z)=>{const h=renderedHeight(x,z);air=Math.max(air,bottom-h);buried=Math.max(buried,h-top);};
  sample(...centre);
  for(let i=0;i<q.length;i++){
    const a=q[i],b=q[(i+1)%q.length],N=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3));
    for(let j=0;j<=N;j++){
      const p=[a[0]+(b[0]-a[0])*j/N,a[1]+(b[1]-a[1])*j/N];sample(...p);
      if(j%4===0)for(const f of [.2,.4,.6,.8])sample(centre[0]+(p[0]-centre[0])*f,centre[1]+(p[1]-centre[1])*f);
    }
  }
  return {air,buried,bottom,top,q};
}
function overlaps(a,b,pad=.05){
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],axis=[-(q[1]-p[1]),q[0]-p[0]],L=Math.hypot(...axis);axis[0]/=L;axis[1]/=L;
    const A=a.map(p=>p[0]*axis[0]+p[1]*axis[1]),B=b.map(p=>p[0]*axis[0]+p[1]*axis[1]);
    if(Math.max(...A)<=Math.min(...B)+pad||Math.max(...B)<=Math.min(...A)+pad)return false;
  }return true;
}

check('independent closure positive and negative controls',()=>{
  const closed=islandPrism(rectangle(0,0,10,8),0,6),open=closed.clone();open.setIndex(Array.from(open.index.array).slice(0,-6));
  assert(valid(topology(closed)));assert(topology(closed).signedVolume>0);assert(topology(open).boundaryEdges>0,'an intentionally missing face must be detected');
});
check('independent footprint collision controls',()=>{
  assert(overlaps(rectangle(0,0,10,8),rectangle(8,0,10,8)));assert(!overlaps(rectangle(0,0,10,8),rectangle(20,0,10,8)));
});


function verticalSection(geometry,x,z){
  const p=geometry.attributes.position,index=geometry.index,ray=new THREE.Ray(new THREE.Vector3(x,1e5,z),new THREE.Vector3(0,-1,0)),A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3(),hit=new THREE.Vector3(),ys=[];
  const n=index?index.count:p.count;for(let j=0;j<n;j+=3){A.fromBufferAttribute(p,index?index.getX(j):j);B.fromBufferAttribute(p,index?index.getX(j+1):j+1);C.fromBufferAttribute(p,index?index.getX(j+2):j+2);if(ray.intersectTriangle(A,B,C,false,hit))ys.push(hit.y);}
  return {min:Math.min(...ys),max:Math.max(...ys),hits:ys.length};
}
function stackSupported(geometry){
  const stack=geometry.userData.islandSupport;
  return stack.samples.every(([x,z])=>{const a=verticalSection(geometry,x,z),b=verticalSection(stack.lower,x,z);return a.hits&&b.hits&&b.max+.025>=a.min&&b.min<=a.min;});
}

const result=buildSkyline(new THREE.Scene(),{audit:true});
const foundations=result.auditParts.filter(p=>p.geometry.userData.islandFoundation);
const stats={triangles:result.tris,components:result.auditParts.length,foundations:foundations.length,cities:[],geometryCosts:[]};
for(const c of [...result.cities.islands,...result.cities.massif]){const costs={city:c.id,triangles:0,publicRoads:0,entranceStairs:0,accessLanes:0,foundations:0,otherArchitecture:0};for(const p of result.auditParts){if(!p.name.startsWith(c.name))continue;const g=p.geometry,n=(g.index?.count??g.attributes.position.count)/3;costs.triangles+=n;const kind=g.userData.islandStair?'entranceStairs':g.userData.islandRoad?(g.userData.islandAccess?'accessLanes':'publicRoads'):g.userData.islandFoundation?'foundations':'otherArchitecture';costs[kind]+=n;}stats.geometryCosts.push(costs);}

check('every structural component is closed and consistently wound',()=>{
  // (island-kit geometries hold many touching solids: each recorded solid is audited on its own)
  const failures=[];for(const p of result.auditParts){if(p.geometry.userData.islandSolids){for(const f of auditSolids(p.geometry,{limit:5}).failures)if(failures.length<15)failures.push({name:p.name,...f});continue;}const a=topology(p.geometry);if(!valid(a)&&failures.length<15)failures.push({name:p.name,stair:p.geometry.userData.islandStair,...a});}
  assert.equal(failures.length,0,JSON.stringify(failures,null,2));
});
check('foundations support their actual projected geometry',()=>{
  const failures=[];for(const p of foundations){const a=foundationSupport(p.geometry);if((a.air>.025||a.buried>.08)&&failures.length<15)failures.push({name:p.geometry.userData.islandFoundation.name,air:a.air,buried:a.buried});}
  assert.equal(failures.length,0,JSON.stringify(failures,null,2));
  // (Thalassa's temple acropolis is audited with the island-kit solids: tools/verify-island-cities.mjs)
  const temple=foundations.find(p=>p.geometry.userData.islandFoundation.name==='Austral spire foundation');assert(temple);
  const raised=temple.geometry.clone().translate(0,100,0);assert(foundationSupport(raised).air>40,'an unsupported translated foundation must be detected');
  const austral=foundations.find(p=>p.geometry.userData.islandFoundation.name==='Austral spire foundation');assert(austral);
  assert(foundationSupport(austral.geometry).top>50,'the podium must clear its uphill perimeter');
});
check('civic roofs and instrument heads sit on actual solid supports',()=>{
  const stacked=result.auditParts.filter(p=>p.geometry.userData.islandSupport);assert(stacked.length>=100);
  for(const p of stacked)assert(stackSupported(p.geometry),`${p.geometry.userData.islandSupport.name} has a physical support gap`);
  const g=stacked[0].geometry,raised=g.clone().translate(0,5,0);raised.userData=g.userData;assert(!stackSupported(raised),'raising a roof from its support must fail');
});
check('all three massif towns build their civic terraces',()=>{
  const names=foundations.map(p=>p.geometry.userData.islandFoundation.name);
  for(const name of ['Ridgeholm','Highgate','Cloudmere'])assert(names.includes(`${name} civic terrace`),`${name} civic destination was rejected`);
});
check('massif civic approaches meet their squares and front edges without crossing their own platforms',()=>{
  const approaches=result.auditParts.filter(p=>p.geometry.userData.islandCivicApproach);assert.equal(approaches.length,3);
  const onTop=(g,point,y)=>[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(g,point[0]+dx,point[1]+dz);return v.hits&&Math.abs(v.max-y)<.025;});
  for(const {geometry:g}of approaches){const e=g.userData.islandCivicApproach,pad=foundations.find(p=>p.geometry.userData.islandFoundation.name===`${e.town} civic terrace`).geometry,q=hull(pad);
    assert(onTop(g,e.from,e.startY));assert(onTop(g,e.to,e.endY));assert(onTop(pad,e.to,e.endY));
    assert(result.auditParts.filter(p=>p.name===`${e.town} prism`).some(p=>onTop(p.geometry,e.from,e.startY)),`${e.town} approach misses gondola square`);
    for(const p of g.userData.islandRoad.points.slice(1,-1)){const c=q.map((a,i)=>{const b=q[(i+1)%q.length];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});assert(!(c.every(v=>v>.02)||c.every(v=>v<-.02)),`${e.town} approach runs through its own raised platform`);}
  }
});
check('tower and needle collars rise monotonically in actual mesh rows',()=>{
  let count=0;for(const {geometry:g}of result.auditParts){const q=g.userData.islandLatheProfile;if(!q)continue;const p=g.attributes.position;for(let row=1;row<q.rows;row++)assert(p.getY(row*(q.segments+1))>=p.getY((row-1)*(q.segments+1))-.0001,'a tower collar folds down through the preceding body');count++;}assert(count>=8,`only ${count} tower lathes audited`);   // Thalassa, Anchorage and Orison now build from islands/cityKit.js (verify-island-cities.mjs audits those)stats.monotonicTowerProfiles=count;
});
check('island geometry stays in its own geographical envelope',()=>{
  for(const c of result.cities.islands){
    const m=result.meshes.find(m=>m.name===`${c.name} (island city)`),p=m.geometry.attributes.position;let far=0;
    for(let i=0;i<p.count;i++)far=Math.max(far,Math.hypot(p.getX(i)-c.ix,p.getZ(i)-c.iz));
    assert(far<c.coast.s*1.6+1000,`${c.id} geometry escaped its island: ${far}`);
  }
});
check('all inland destinations connect to the ferry arrival',()=>{
  for(const p of result.plans){
    const reached=new Set(['harbour']);for(let i=0;i<=p.sites.length;i++)for(const e of p.routes){if(reached.has(e.from))reached.add(e.to);if(reached.has(e.to))reached.add(e.from);}
    assert(p.sites.length>=5);for(const s of p.sites)assert(reached.has(s.id),`${s.id} is disconnected`);
    for(const r of p.routes){assert(r.points.length>2);assert(r.points.flat().every(Number.isFinite));}
  }
});
check('inhabited and productive plots have clear street entrances',()=>{
  for(const p of result.plans){
    const types=['home','designed grounds','hospice','garden laboratory','cultivation','countryside holding'];
    for(const q of p.plots.filter(q=>types.includes(q.type)))assert(q.access,`${p.city} ${q.type} at ${q.x},${q.z} has no entrance`);
  }
});
check('entrance stair meshes meet their actual street and terrace surfaces',()=>{
  const roads=result.auditParts.filter(p=>p.geometry.userData.islandRoad&&!p.geometry.userData.islandAccess&&!p.geometry.userData.islandStair).map(p=>{p.geometry.computeBoundingBox();return p.geometry;});
  const startMap=new Map(),endMap=new Map(),key=p=>p.map(v=>v.toFixed(5)).join(',');
  const add=(map,k,g)=>{if(!map.has(k))map.set(k,[]);map.get(k).push(g);};
  for(const {geometry:g}of result.auditParts){const stair=g.userData.islandStair;if(stair){add(startMap,key(stair.from),g);add(endMap,key(stair.to),g);}if(g.userData.islandAccess){const path=g.userData.islandRoad.points;add(startMap,key(path[0]),g);add(endMap,key(path.at(-1)),g);}}
  const matches=(g,y,point=g.userData.islandRoad?.points[0])=>{if(g.userData.islandRoad)return [[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(g,point[0]+dx,point[1]+dz);return v.hits&&Math.abs(v.max-y)<(g.userData.islandStair?.286:.035);});const p=g.attributes.position;let top=-Infinity;for(let i=0;i<p.count;i++)top=Math.max(top,p.getY(i));return Math.abs(top-y)<=.285;};
  const entries=result.plans.flatMap(p=>p.plots.filter(q=>q.accessHeights).map(plot=>({city:p.city,plot}))),core=result.auditParts.filter(p=>p.geometry.userData.islandEntry);
  for(const item of core){const e=item.geometry.userData.islandEntry;entries.push({city:item.name,plot:{access:[e.from,e.to],accessHeights:[e.startY,e.endY],source:e.source,kind:e.kind}});}
  const pads=new Map();for(const {geometry:g}of foundations){g.computeBoundingBox();const bb=g.boundingBox;for(let x=Math.floor(bb.min.x/128);x<=Math.floor(bb.max.x/128);x++)for(let z=Math.floor(bb.min.z/128);z<=Math.floor(bb.max.z/128);z++){const key=x+','+z;if(!pads.has(key))pads.set(key,[]);pads.get(key).push(g);}}
  for(const p of entries){const plot=p.plot;
    const [a,b]=plot.access,[y0,y1]=plot.accessHeights;
    assert((startMap.get(key(a))||[]).some(g=>matches(g,y0,a)),`${p.city} entrance stair misses its street elevation: ${JSON.stringify({plot,matches:(startMap.get(key(a))||[]).map(g=>({stair:g.userData.islandStair,road:g.userData.islandRoad?.sections[0]}))})}`);
    assert((endMap.get(key(b))||[]).some(g=>matches(g,y1,b)),`${p.city} entrance stair misses its terrace elevation`);
    const street=roads.some(g=>{const bb=g.boundingBox;if(a[0]<bb.min.x-.01||a[0]>bb.max.x+.01||a[1]<bb.min.z-.01||a[1]>bb.max.z+.01)return false;return [[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(g,a[0]+dx,a[1]+dz);return v.hits&&Math.abs(v.max-y0)<.035;});});
    const fromPad=plot.source==='foundation'&&(pads.get(Math.floor(a[0]/128)+','+Math.floor(a[1]/128))||[]).some(g=>[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(g,a[0]+dx,a[1]+dz);return v.hits&&Math.abs(v.max-y0)<.025;}));
    assert(street||fromPad,`${p.city} entrance starts above or below its actual street mesh: ${JSON.stringify({a,y0,heights:roads.filter(g=>{const bb=g.boundingBox;return a[0]>=bb.min.x-.01&&a[0]<=bb.max.x+.01&&a[1]>=bb.min.z-.01&&a[1]<=bb.max.z+.01;}).map(g=>verticalSection(g,...a)).filter(s=>s.hits)})}`);
    const pad=(pads.get(Math.floor(b[0]/128)+','+Math.floor(b[1]/128))||[]).some(g=>[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(g,b[0]+dx,b[1]+dz);return v.hits&&Math.abs(v.max-y1)<.025;}));
    assert(pad,`${p.city} entrance misses its actual pad surface`);
    const caps=(map,point,other)=>{const direction=[other[0]-point[0],other[1]-point[1]],L=Math.hypot(...direction);return (map.get(key(point))||[]).filter(g=>{const e=g.userData.islandStair,pts=g.userData.islandRoad?.points,q=e?(map===startMap?e.to:e.from):(map===startMap?pts[1]:pts.at(-2)),d=[q[0]-point[0],q[1]-point[1]];return(d[0]*direction[0]+d[1]*direction[1])/(Math.hypot(...d)*L)>.999;}).map(g=>{if(g.userData.islandRoad){const s=map===startMap?g.userData.islandRoad.sections[0]:g.userData.islandRoad.sections.at(-1);return{g,edge:{a:s.left.map(Math.fround),b:s.right.map(Math.fround),distance:0}};}const q=hull(g),edge=q.map((a,i)=>({a,b:q[(i+1)%q.length],distance:pointSegmentDistance(...point,a,q[(i+1)%q.length])})).sort((a,b)=>a.distance-b.distance)[0];return{g,edge};}).filter(p=>p.edge.distance<.02);};
    for(const [point,other,map,y,source]of [[a,b,startMap,y0,true],[b,a,endMap,y1,false]]){
      const candidates=caps(map,point,other);assert(candidates.length,'entrance endpoint does not correspond to a real mesh cap');
      assert(candidates.some(({g,edge})=>[.1,.5,.9].every(f=>{const p=[edge.a[0]+(edge.b[0]-edge.a[0])*f,edge.a[1]+(edge.b[1]-edge.a[1])*f],ys=[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].map(([dx,dz])=>verticalSection(g,p[0]+dx,p[1]+dz).max),capY=Math.max(...ys),at=(s)=>[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].some(([dx,dz])=>{const v=verticalSection(s,p[0]+dx,p[1]+dz);return v.hits&&Math.abs(v.max-y)<.035&&Math.abs(capY-v.max)<=.286;});
        const nearby=(pads.get(Math.floor(p[0]/128)+','+Math.floor(p[1]/128))||[]).filter(g=>!source||plot.source==='foundation'||g.userData.islandFoundation.name.includes('entrance apron'));
        if(nearby.some(at))return true;if(!source)return false;return roads.some(s=>{const bb=s.boundingBox;return p[0]>=bb.min.x-.01&&p[0]<=bb.max.x+.01&&p[1]>=bb.min.z-.01&&p[1]<=bb.max.z+.01&&at(s);});
      })),`${p.city}: ${plot.kind||plot.type} entrance lacks full-width physical ${source?'street':'terrace'} contact at ${point}`);
    }
  }
  stats.entrancesWithPhysicalContacts=entries.length;stats.coreEntrances=core.filter(p=>p.geometry.userData.islandEntry.kind==='urban core').length;
  const g=startMap.values().next().value[0],point=g.userData.islandStair?.from??g.userData.islandRoad.points[0],top=Math.max(...[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].map(([dx,dz])=>verticalSection(g,point[0]+dx,point[1]+dz).max));assert(matches(g,top,point));assert(!matches(g.clone().translate(0,2,0),top,point),'a stair displaced from its landing must fail');
});
check('private entrance and access interiors remain above actual terrain',()=>{
  const sampleTriangle=v=>{let buried=0;for(const p of [...v,v.reduce((a,b)=>a.map((x,k)=>x+b[k]/3),[0,0,0])])buried=Math.max(buried,renderedHeight(p[0],p[2])-p[1]);return buried;};
  // Exact original Austral cultivation approach: both endpoint contacts passed,
  // while this actual tread triangle was buried 14.20 m inside the hillside.
  const broken=[[16554.900390625,167.43585205078125,38123.80859375],[16555.5703125,167.43585205078125,38122.8203125],[16552.921875,167.43585205078125,38121.0234375]];
  assert(sampleTriangle(broken)>14);assert(sampleTriangle(broken.map(p=>[p[0],p[1]+20,p[2]]))===0);
  const failures=[];let triangles=0,stairs=0,lanes=0,maxRiser=0,minRun=Infinity,maxLaneGrade=0,previous;
  for(const {name,geometry:g}of result.auditParts){
    if(!g.userData.islandStair&&!g.userData.islandAccess){previous=undefined;continue;}
    const p=g.attributes.position,f=g.attributes.aFacade;let buried=0,top=-Infinity;
    for(let i=0;i<g.index.count;i+=3){const ids=[0,1,2].map(k=>g.index.getX(i+k));if(f.getZ(ids[0])!==9)continue;const v=ids.map(k=>[p.getX(k),p.getY(k),p.getZ(k)]),u=v[1].map((x,k)=>x-v[0][k]),w=v[2].map((x,k)=>x-v[0][k]),n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];if(Math.abs(n[1])<=1e-6){maxRiser=Math.max(maxRiser,Math.max(...v.map(p=>p[1]))-Math.min(...v.map(p=>p[1])));continue;}if(n[1]<0)continue;triangles++;buried=Math.max(buried,sampleTriangle(v));top=Math.max(top,...v.map(p=>p[1]));if(g.userData.islandAccess)maxLaneGrade=Math.max(maxLaneGrade,Math.hypot(n[0],n[2])/n[1]);}
    if(buried>.08&&failures.length<15)failures.push({name,buried,stair:g.userData.islandStair,path:g.userData.islandRoad?.points});
    if(g.userData.islandStair){stairs++;const pts=g.userData.islandRoad.points;for(let i=1;i<pts.length;i++){const run=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(run>1e-5)minRun=Math.min(minRun,run);}}else lanes++;
  }
  assert.equal(failures.length,0,JSON.stringify(failures));assert(maxRiser<=.283,`actual consecutive tread rise ${maxRiser}`);
  stats.privateRoutes={triangles,stairs,lanes,maxRiser,minRun,maxLaneGrade};
});
check('core street junctions share actual mesh elevations',()=>{
  const ends=new Map();for(const {geometry:g}of result.auditParts){const s=g.userData.islandStreet;if(!s)continue;const p=g.attributes.position;
    for(const point of [s.from,s.to]){const key=point.map(v=>v.toFixed(5)).join(',');if(!ends.has(key))ends.set(key,[]);const y=Math.max(...[[0,0],[.006,0],[-.006,0],[0,.006],[0,-.006]].map(([dx,dz])=>verticalSection(g,point[0]+dx,point[1]+dz).max));assert(Number.isFinite(y));ends.get(key).push(y);}
  }
  let junctions=0;for(const ys of ends.values())if(ys.length>1){assert(Math.max(...ys)-Math.min(...ys)<.003,'city street junction has a vertical seam');junctions++;}assert(junctions>1000);stats.levelStreetJunctions=junctions;
});
check('public roads have founded treads, level physical crossings, and one walkable island network',()=>{
  const clip=(source,clipper)=>{let poly=source;const area=clipper.reduce((s,p,i)=>s+p[0]*clipper[(i+1)%clipper.length][1]-p[1]*clipper[(i+1)%clipper.length][0],0),sign=Math.sign(area);
    for(let i=0;i<clipper.length;i++){const a=clipper[i],b=clipper[(i+1)%clipper.length],side=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])),out=[];
      for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],u=side(p),v=side(q);if(u>=-1e-7)out.push(p);if((u>=-1e-7)!==(v>=-1e-7)){const f=u/(u-v);out.push([p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f]);}}poly=out;if(!poly.length)break;
    }return poly;
  };
  const height=(t,p)=>t.y+t.hx*(p[0]-t.q[0][0])+t.hz*(p[1]-t.q[0][1]);
  const seam=(a,b,q)=>q.length?Math.max(...q.map(p=>Math.abs(height(a,p)-height(b,p)))):0;
  const coverage=[];let samples=0,crossings=0,risers=0,maxRamp=0;
  for(const city of result.cities.islands){
    const roads=result.auditParts.filter(p=>p.name.startsWith(city.name)&&(p.geometry.userData.islandStreet||p.geometry.userData.islandRole)).map(p=>p.geometry),parent=roads.map((_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[a]=b;},grid=new Map(),triangles=[];
    roads.forEach((g,road)=>{const p=g.attributes.position,f=g.attributes.aFacade,idx=g.index;
      for(let i=0;i<idx.count;i+=3){const ids=[0,1,2].map(k=>idx.getX(i+k)),v=ids.map(k=>[p.getX(k),p.getY(k),p.getZ(k)]),u=v[1].map((x,k)=>x-v[0][k]),w=v[2].map((x,k)=>x-v[0][k]),n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
        const walking=f.getZ(ids[0])===(g.userData.islandRoad.kind??9),centre=v.reduce((s,p)=>s.map((x,k)=>x+p[k]/3),[0,0,0]);
        if(!walking){if(n[1]/Math.hypot(...n)<-.2)for(const q of [...v,centre])assert(q[1]<=renderedHeight(q[0],q[2])+.04,`${city.id}: road underside floats`);continue;}
        if(Math.abs(n[1])<1e-5){const rise=Math.max(...v.map(p=>p[1]))-Math.min(...v.map(p=>p[1]));assert(rise<=.262,`${city.id}: road riser ${rise}m`);risers++;continue;}
        assert(n[1]>0,'walking face points down');
        const q=v.map(p=>[p[0],p[2]]),t={id:triangles.length,road,q,y:v[0][1],hx:-n[0]/n[1],hz:-n[2]/n[1],x0:Math.min(...q.map(p=>p[0])),x1:Math.max(...q.map(p=>p[0])),z0:Math.min(...q.map(p=>p[1])),z1:Math.max(...q.map(p=>p[1]))};triangles.push(t);
        const slope=Math.hypot(t.hx,t.hz);maxRamp=Math.max(maxRamp,slope);assert(slope<=.225,`${city.id}: steep unstepped road face ${slope}`);
        for(const p of [...v,centre]){assert(p[1]>=renderedHeight(p[0],p[2])-.035,`${city.id}: road paving is buried`);samples++;}
        for(let x=Math.floor(t.x0/64);x<=Math.floor(t.x1/64);x++)for(let z=Math.floor(t.z0/64);z<=Math.floor(t.z1/64);z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(t);}
      }
    });
    const contacts=new Map(),pairs=new Set();for(const entries of grid.values())for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
      const a=entries[i],b=entries[j];if(a.road===b.road||a.x1<b.x0||b.x1<a.x0||a.z1<b.z0||b.z1<a.z0)continue;const key=a.id+','+b.id;if(pairs.has(key))continue;pairs.add(key);const q=clip(a.q,b.q);if(!q.length)continue;
      let span=0;for(const p of q)for(const r of q)span=Math.max(span,Math.hypot(p[0]-r[0],p[1]-r[1]));if(span<.02)continue;
      assert(seam(a,b,q)<.035,`${city.id}: actual road crossing has a ${seam(a,b,q)}m seam at ${q[0]}`);crossings++;if(span>2.35)join(a.road,b.road);else{const key=[a.road,b.road].sort((a,b)=>a-b).join(',');if(!contacts.has(key))contacts.set(key,[]);contacts.get(key).push(q);}
    }
    // Refined junctions consist of many short top triangles. Join their adjacent
    // intersection polygons before measuring passage width, rather than demanding
    // that one tessellation triangle alone span the entire usable contact.
    for(const [key,qs]of contacts){const [a,b]=key.split(',').map(Number);if(root(a)===root(b))continue;const P=qs.map((_,i)=>i),R=i=>{while(P[i]!==i){P[i]=P[P[i]];i=P[i];}return i;},bounds=qs.map(q=>({x0:Math.min(...q.map(p=>p[0])),x1:Math.max(...q.map(p=>p[0])),z0:Math.min(...q.map(p=>p[1])),z1:Math.max(...q.map(p=>p[1]))}));
      const touch=(q,r)=>{for(const s of [q,r])for(let i=0;i<s.length;i++){const p=s[i],b=s[(i+1)%s.length],nx=-(b[1]-p[1]),nz=b[0]-p[0],L=Math.hypot(nx,nz);if(L<1e-7)continue;const A=q.map(p=>p[0]*nx+p[1]*nz),B=r.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...A)<Math.min(...B)-L*.005||Math.max(...B)<Math.min(...A)-L*.005)return false;}return true;};
      for(let i=0;i<qs.length;i++)for(let j=i+1;j<qs.length;j++){const a=bounds[i],b=bounds[j];if(a.x1<b.x0-.005||b.x1<a.x0-.005||a.z1<b.z0-.005||b.z1<a.z0-.005)continue;if(touch(qs[i],qs[j]))P[R(i)]=R(j);}
      const groups=new Map();bounds.forEach((b,i)=>{const key=R(i),g=groups.get(key)||{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity};for(const k of ['x0','z0'])g[k]=Math.min(g[k],b[k]);for(const k of ['x1','z1'])g[k]=Math.max(g[k],b[k]);groups.set(key,g);});if([...groups.values()].some(g=>Math.max(g.x1-g.x0,g.z1-g.z0)>2.35))join(a,b);
    }
    const groups=new Map();roads.forEach((g,i)=>{const r=root(i);groups.set(r,(groups.get(r)||0)+1);});assert.equal(groups.size,1,`${city.id}: disconnected actual road components ${[...groups.values()]}`);coverage.push({city:city.id,roads:roads.length,components:groups.size});
  }
  const p=[-20081.940966,14944.209716],a={q:rectangle(...p,20,6),y:27.269,hx:0,hz:0},b={q:rectangle(...p,6,20),y:8.710,hx:0,hz:0};assert(seam(a,b,clip(a.q,b.q))>18.55,'the measured original Anchorage junction must fail the physical crossing oracle');
  stats.roadSurfaceSamples=samples;stats.physicalRoadCrossings=crossings;stats.roadRiserTriangles=risers;stats.maximumRoadRamp=maxRamp;stats.islandRoadNetwork=coverage;
});
check('core foundations and civic destinations reserve disjoint actual footprints',()=>{
  let checked=0;for(const c of result.cities.islands){const city=foundations.filter(p=>p.name.startsWith(c.name)),core=city.filter(p=>/street-front plot|tower court|neighbourhood garden/.test(p.geometry.userData.islandFoundation.name)),civic=city.filter(p=>/civic plinth|arrival square/.test(p.geometry.userData.islandFoundation.name));
    for(const a of core){const q=hull(a.geometry);for(const b of civic){assert(!overlaps(q,hull(b.geometry)),`${c.id}: core plot penetrates civic destination`);checked++;}}
    const gardens=core.filter(p=>p.geometry.userData.islandFoundation.name.includes('neighbourhood garden')),entries=result.auditParts.filter(p=>p.name.startsWith(c.name)&&p.geometry.userData.islandEntry?.kind==='neighbourhood garden');assert.equal(gardens.length,entries.length,'every raised core garden requires a founded street entrance');
  }stats.coreCivicFootprintChecks=checked;
});
check('independent footprint separation and civic route clearance',()=>{
  for(const p of result.plans){
    const plots=p.plots.filter(q=>q.q&&q.type!=='arrival square');
    for(let i=0;i<plots.length;i++)for(let j=i+1;j<plots.length;j++){
      const a=plots[i],b=plots[j];if(Math.hypot(a.x-b.x,a.z-b.z)>a.r+b.r)continue;
      assert(!overlaps(a.q,b.q),`${p.city}: ${a.type}/${b.type} footprints overlap at ${a.x},${a.z}`);
    }
    for(const q of plots.filter(q=>q.type==='civic landmark')){
      const radius=q.r-10;
      for(const [a,b]of p.localRoutes)assert(pointSegmentDistance(q.x,q.z,a,b)>=radius+3.4,`${p.city} local street cuts civic platform`);
      for(const r of p.routes)for(let i=1;i<r.points.length;i++)assert(pointSegmentDistance(q.x,q.z,r.points[i-1],r.points[i])>=radius+r.width/2-.1,`${p.city} regional street cuts civic platform`);
    }
    stats.cities.push({id:p.city,destinations:p.sites.length,homes:p.plots.filter(q=>q.type==='home').length,designedGrounds:p.plots.filter(q=>q.type==='designed grounds').length,cultivation:p.plots.filter(q=>q.type==='cultivation').length,countrysideHoldings:p.plots.filter(q=>q.type==='countryside holding').length});
  }
});
check('countryside gates land on real foundation edges',()=>{
  const holdings=foundations.filter(p=>p.geometry.userData.islandFoundation.name.includes('countryside holding'));
  for(const p of result.plans)for(const plot of p.plots.filter(q=>q.type==='countryside holding')){
    const foundation=holdings.find(p=>{const q=p.geometry.userData.islandFoundation.q;return Math.hypot(q.reduce((s,p)=>s+p[0]/q.length,0)-plot.x,q.reduce((s,p)=>s+p[1]/q.length,0)-plot.z)<.01;});assert(foundation);
    const q=hull(foundation.geometry),gate=plot.access[1],gap=Math.min(...q.map((a,i)=>pointSegmentDistance(...gate,a,q[(i+1)%q.length])));
    assert(gap<.015,`${p.city} countryside entrance misses its actual pad edge by ${gap}m`);
  }
});
check('massif square and station share a founded surveyed arrival datum',()=>{
  const arrivals=[];
  for(const town of outerCities().massif){
    const arrival=massifArrival(town),part=result.auditParts.find(p=>p.name.startsWith(town.name)&&p.geometry.userData.islandMassifTerrace?.kind==='station square');assert(part);
    const square=foundationSupport(part.geometry);assert(square.air<.025&&square.buried<.08);assert(Math.abs(square.top-arrival.level)<.001);
    // Radial interior and edge samples are independent of the helper's survey.
    for(let i=0;i<120;i++)for(let r=0;r<=20.8;r+=.8){const a=i*Math.PI*2/120;assert(renderedHeight(arrival.center[0]+Math.cos(a)*r,arrival.center[1]+Math.sin(a)*r)<arrival.level-.25,'the station disk protrudes through its shared arrival level');}
    arrivals.push({town:town.id,level:arrival.level});
  }
  const ridge=arrivals.find(a=>a.town==='ridgeholm'),old=outerCities().massif.find(m=>m.id==='ridgeholm');assert(ridge.level-(renderedHeight(old.town.x,old.town.z)-.2)>18,'the original centre-only station datum must fail the shared-level check');
  stats.massifArrivalLevels=arrivals;
});
check('massif house bodies and promenade junctions have physical clearance',()=>{
  const bodies=result.auditParts.filter(p=>p.geometry.userData.islandMassifHouse).map(p=>{const g=p.geometry;g.computeBoundingBox();return {q:hull(g),b:g.boundingBox,run:g.userData.islandMassifHouse.runId};}).sort((a,b)=>a.b.min.x-b.b.min.x);
  const collides=(a,b)=>a.b.max.y>b.b.min.y+.03&&b.b.max.y>a.b.min.y+.03&&overlaps(a.q,b.q,.03);
  assert(collides(bodies[0],bodies[0]),'a duplicated actual house must fail the overlap oracle');
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length&&bodies[j].b.min.x<bodies[i].b.max.x;j++)assert(!collides(bodies[i],bodies[j]),`${bodies[i].run}/${bodies[j].run}: house bodies overlap`);
  const intersection=(poly,q)=>{let out=poly;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length],side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),src=out;out=[];if(!src.length)break;for(let j=0;j<src.length;j++){const p=src[j],r=src[(j+1)%src.length],sp=side(p),sr=side(r),pin=sp>=-.0001,rin=sr>=-.0001;if(pin)out.push(p);if(pin!==rin){const t=sp/(sp-sr);out.push([p[0]+(r[0]-p[0])*t,p[1]+(r[1]-p[1])*t]);}}}return out;};
  const passage=(a,b)=>{const poly=intersection(a,b);let span=0;for(const p of poly)for(const q of poly)span=Math.max(span,Math.hypot(p[0]-q[0],p[1]-q[1]));return span;};
  const groups=new Map();for(const {geometry:g}of result.auditParts){const t=g.userData.islandMassifPromenade;if(!t)continue;if(!groups.has(t.runId))groups.set(t.runId,[]);groups.get(t.runId).push(hull(g));}
  let joints=0;for(const [run,qs]of groups)for(let i=1;i<qs.length;i++){assert(passage(qs[i-1],qs[i])>=2.35,`${run}: promenade sections leave a narrow or disconnected joint`);joints++;}
  const fixture=[...groups.values()].find(qs=>qs.length>1);assert.equal(passage(fixture[0],fixture[1].map(p=>[p[0]+1000,p[1]])),0,'a detached actual promenade section must fail contact');
  stats.massifNonOverlappingHouseBodies=bodies.length;stats.massifConnectedPromenadeJoints=joints;
});
check('massif houses have actual terrace or terrain support at every base corner',()=>{
  const support=new Map(),houses=[];
  for(const part of result.auditParts){if(!/^(Ridgeholm|Highgate|Cloudmere) prism$/.test(part.name))continue;const g=part.geometry;g.computeBoundingBox();const b=g.boundingBox,k=g.attributes.aFacade.getZ(0);
    if(k===5&&b.max.y-b.min.y>=5)houses.push(g);
    if(k===1)for(let x=Math.floor(b.min.x/50);x<=Math.floor(b.max.x/50);x++)for(let z=Math.floor(b.min.z/50);z<=Math.floor(b.max.z/50);z++){const k=x+','+z;if(!support.has(k))support.set(k,[]);support.get(k).push(g);}
  }
  const supported=g=>{g.computeBoundingBox();const bottom=g.boundingBox.min.y,p=g.attributes.position,pts=new Map();for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i)-bottom)<.01)pts.set(p.getX(i)+','+p.getZ(i),[p.getX(i),p.getZ(i)]);const q=[...pts.values()],cx=q.reduce((s,p)=>s+p[0]/q.length,0),cz=q.reduce((s,p)=>s+p[1]/q.length,0);
    return q.every(([x0,z0])=>{const x=x0+(cx-x0)*.001,z=z0+(cz-z0)*.001;if(renderedHeight(x,z)>=bottom-.025)return true;return (support.get(Math.floor(x/50)+','+Math.floor(z/50))||[]).some(g=>{const v=verticalSection(g,x,z);return v.hits&&v.max>=bottom-.025&&v.min<=bottom+.025;});});
  };
  assert(houses.length>3000);for(const g of houses)assert(supported(g),'massif house overhangs its terrace support');assert(!supported(houses[0].clone().translate(0,100,0)),'an airborne massif house must fail');stats.supportedMassifBuildings=houses.length;
});
check('every massif flight meets other solids at both actual mesh ends',()=>{
  const parts=result.auditParts,flights=[],supports=new Map(),indexKey=(x,z)=>Math.floor(x/40)+','+Math.floor(z/40);
  for(let i=0;i<parts.length;i++){
    const {geometry:g,name}=parts[i];if(!/^(Ridgeholm|Highgate|Cloudmere) prism$/.test(name))continue;g.computeBoundingBox();const b=g.boundingBox;
    if(g.userData.islandMassifStair)flights.push({i,e:g.userData.islandMassifStair,name});
    for(let x=Math.floor(b.min.x/40);x<=Math.floor(b.max.x/40);x++)for(let z=Math.floor(b.min.z/40);z<=Math.floor(b.max.z/40);z++){const key=x+','+z;if(!supports.has(key))supports.set(key,[]);supports.get(key).push({i,g});}
  }
  const topAt=(g,p)=>{let y=-Infinity;for(const [dx,dz]of [[0,0],[.004,0],[-.004,0],[0,.004],[0,-.004]]){const v=verticalSection(g,p[0]+dx,p[1]+dz);if(v.hits)y=Math.max(y,v.max);}return y;};
  const contact=(geometry,p,y,candidates,excluded)=>Math.abs(topAt(geometry,p)-y)<.025&&candidates.some(({i,g})=>!excluded.has(i)&&Math.abs(topAt(g,p)-y)<.025);
  const failures=[];
  for(const {i,e,name}of flights){const own=new Set(Array.from({length:e.components},(_,k)=>i+k)),dir=[e.to[0]-e.from[0],e.to[1]-e.from[1]],len=Math.hypot(...dir);dir[0]/=len;dir[1]/=len;
    for(const [point,yy,which,g]of [[e.from,e.startY,'upper',parts[i].geometry],[e.to,e.endY,'lower',parts[i+e.components-1].geometry]]){const q=hull(g),edge=q.map((a,j)=>({a,b:q[(j+1)%q.length],distance:pointSegmentDistance(...point,a,q[(j+1)%q.length])})).sort((a,b)=>a.distance-b.distance)[0];assert(edge.distance<.012,'stair metadata does not identify an actual cap');for(const lateral of [-.4,0,.4]){
      const f=lateral+.5,p=[edge.a[0]+(edge.b[0]-edge.a[0])*f,edge.a[1]+(edge.b[1]-edge.a[1])*f];
      if(!contact(g,p,yy,supports.get(indexKey(...p))||[],own)&&failures.length<12)failures.push({name,which,lateral,p,yy,actual:topAt(g,p),terrain:renderedHeight(...p)});
    }}
  }
  assert(flights.length>100,'the surviving three-town network must retain substantial inter-terrace circulation');assert.equal(failures.length,0,JSON.stringify(failures,null,2));
  const landings=parts.filter(p=>p.geometry.userData.islandMassifLanding);
  for(const {geometry:g}of landings){const a=foundationSupport(g);assert(a.air<.025&&a.buried<.04,JSON.stringify({landing:g.userData.islandMassifLanding,air:a.air,buried:a.buried}));}
  for(const {geometry:g}of landings.filter(p=>p.geometry.userData.islandMassifLanding.kind==='lower contour landing')){const q=hull(g),y=g.userData.islandMassifLanding.y,centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]);for(const p of [centre,...q.map(p=>[(p[0]+centre[0])/2,(p[1]+centre[1])/2])])assert((supports.get(indexKey(...p))||[]).some(s=>s.g.userData.islandMassifTerrace&&Math.abs(topAt(s.g,p)-y)<.025),'a lower landing must connect to an actual contour promenade');}
  const walks=parts.map((p,i)=>({...p,i})).filter(p=>p.geometry.userData.islandMassifLandingWalk),walkFailures=[];
  for(const {geometry:g,i,name}of walks){const e=g.userData.islandMassifLandingWalk,dir=[e.to[0]-e.from[0],e.to[1]-e.from[1]],len=Math.hypot(...dir);dir[0]/=len;dir[1]/=len;
    for(const [point,end]of [[e.from,'terrace'],[e.to,'landing']])for(const lateral of [-.4,0,.4]){const p=[point[0]-dir[1]*e.width*lateral,point[1]+dir[0]*e.width*lateral];if(!contact(g,p,e.y,(supports.get(indexKey(...p))||[]).filter(s=>end==='terrace'?s.g.userData.islandMassifTerrace?.runId===e.runId:s.g.userData.islandMassifLanding),new Set([i]))&&walkFailures.length<12)walkFailures.push({name,end,p,y:e.y});}
  }
  assert.equal(walkFailures.length,0,JSON.stringify(walkFailures,null,2));
  const exits=parts.filter(p=>p.geometry.userData.islandMassifGradeExit);assert.equal(exits.length,3);
  for(const {geometry:g}of exits)for(const p of g.userData.islandMassifGradeExit.edge)assert(Math.abs(topAt(g,p)-renderedHeight(...p))<.02,'a grand stair exit does not reach actual terrain');
  // Exact pre-repair Ridgeholm flight. Its lower contour guess lay 0.510 m above
  // the terrain, and its final emitted tread was another 10/39 m above that guess.
  // Including the flight itself as support would conceal this known defect.
  const A=[-7101.1460748,-11729.8123527],B=[-7086.8418178,-11783.9546489],n=39,dir=[B[0]-A[0],B[1]-A[1]],len=Math.hypot(...dir);dir[0]/=len;dir[1]/=len;
  const broken=[];for(let k=0;k<n;k++){const a=[A[0]+(B[0]-A[0])*k/n,A[1]+(B[1]-A[1])*k/n],b=[A[0]+(B[0]-A[0])*(k+1)/n,A[1]+(B[1]-A[1])*(k+1)/n],q=[[a[0]-dir[1]*1.6,a[1]+dir[0]*1.6],[a[0]+dir[1]*1.6,a[1]-dir[0]*1.6],[b[0]+dir[1]*1.6,b[1]-dir[0]*1.6],[b[0]-dir[1]*1.6,b[1]+dir[0]*1.6]];broken.push({i:k,g:islandPrism(q,230,250-10*k/n)});}
  const last=broken.at(-1).g,actual=topAt(last,B);assert(Math.abs(actual-(240+10/39))<.001);assert(actual-renderedHeight(...B)>.75);
  assert(contact(last,B,actual,broken,new Set()),'the fixture must expose the false positive when its own flight is allowed as support');assert(!contact(last,B,actual,broken,new Set(broken.map(p=>p.i))),'excluding the entire own flight must reject the original disconnected lower end');
  // Contacts alone cannot prove usability: a path may enter a parapet or another
  // flight. Probe the walking band of every emitted tread and connecting walk
  // against other actual solids, excluding all pieces of its own flight.
  const obstructionFailures=[];
  const blocked=(g,own,label)=>{const q=hull(g),pos=g.attributes.position;let y=-Infinity;for(let k=0;k<pos.count;k++)y=Math.max(y,pos.getY(k));const centre=q.reduce((sum,p)=>[sum[0]+p[0]/q.length,sum[1]+p[1]/q.length],[0,0]);
    for(const p of [centre,...q.map(p=>[centre[0]+(p[0]-centre[0])*.95,centre[1]+(p[1]-centre[1])*.95])])if(renderedHeight(...p)>y+.08){if(obstructionFailures.length<10)obstructionFailures.push({label,p,y,terrain:renderedHeight(...p)});return;}
    for(const p of [centre,...q.map(p=>[centre[0]+(p[0]-centre[0])*.72,centre[1]+(p[1]-centre[1])*.72])]){
      for(const other of supports.get(indexKey(...p))||[]){if(own.has(other.i))continue;const bb=other.g.boundingBox;if(bb.max.y<y+.35||bb.min.y>y+1.8||p[0]<bb.min.x||p[0]>bb.max.x||p[1]<bb.min.z||p[1]>bb.max.z)continue;const v=verticalSection(other.g,...p);if(v.hits&&v.max>y+.35&&v.min<y+1.8){if(obstructionFailures.length<10)obstructionFailures.push({label,p,y,otherTop:v.max,otherBottom:v.min,other:other.g.userData});return;}}
    }
  };
  const positive=flights[0],tread=parts[positive.i].geometry,q=hull(tread),centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]),obstacle=islandPrism(rectangle(...centre,1.2,1.2),positive.e.startY-.1,positive.e.startY+1.5),cell=supports.get(indexKey(...centre));obstacle.computeBoundingBox();cell.push({i:-1,g:obstacle});blocked(tread,new Set([positive.i]),'injected blocked stair');assert(obstructionFailures.length,'a solid placed on the first tread must be detected');obstructionFailures.length=0;cell.pop();
  for(const {i,e,name}of flights){const own=new Set(Array.from({length:e.components},(_,k)=>i+k));let previous=null;for(let k=0;k<e.components;k++){const g=parts[i+k].geometry;g.computeBoundingBox();const y=g.boundingBox.max.y;if(previous!==null)assert(Math.abs(y-previous)<=.281,'a massif stair has an excessive actual riser');previous=y;blocked(g,own,name+' flight');}}
  for(const {geometry:g,i,name}of walks)blocked(g,new Set([i]),name+' landing walk');
  const promenades=parts.map((p,i)=>({...p,i})).filter(p=>p.geometry.userData.islandMassifPromenade);for(const {geometry:g,i,name}of promenades){blocked(g,new Set([i]),name+' promenade');const a=foundationSupport(g);assert(a.air<.025&&a.buried<.08,JSON.stringify({name,promenade:g.userData.islandMassifPromenade,air:a.air,buried:a.buried,q:a.q}));}
  stats.massifPromenadeSections=promenades.length;
  assert.equal(obstructionFailures.length,0,JSON.stringify(obstructionFailures,null,2));
  stats.massifFlightsWithPhysicalContacts=flights.length;stats.massifFoundedLandings=landings.length;stats.massifGradeExits=exits.length;stats.massifLandingWalks=walks.length;
});
check('all occupied massif runs reach their arrival square through physically verified links',()=>{
  const towns=['Ridgeholm','Highgate','Cloudmere'],coverage=[];
  const onTop=(g,p,y)=>[[0,0],[.004,0],[-.004,0],[0,.004],[0,-.004]].some(([dx,dz])=>{const v=verticalSection(g,p[0]+dx,p[1]+dz);return v.hits&&Math.abs(v.max-y)<.025;});
  for(const town of towns){const parts=result.auditParts.filter(p=>p.name.startsWith(town)),network=parts.find(p=>p.geometry.userData.islandMassifNetwork)?.geometry.userData.islandMassifNetwork;assert(network);
    const occupied=new Set(parts.map(p=>p.geometry.userData.islandMassifHouse?.runId).filter(Boolean)),terraces=new Map(),arrivals=parts.filter(p=>p.geometry.userData.islandMassifTerrace?.kind==='station square'||p.geometry.userData.islandMassifLanding?.kind==='grand stair toe').map(p=>p.geometry),edges=[];
    for(const {geometry:g}of parts){const id=g.userData.islandMassifTerrace?.runId;if(id){if(!terraces.has(id))terraces.set(id,[]);terraces.get(id).push(g);}}
    for(let i=0;i<parts.length;i++){const e=parts[i].geometry.userData.islandMassifStair;if(!e?.network)continue;const q=e.network;
      for(const [id,p,y,g]of [[q.from,e.from,e.startY,parts[i].geometry],[q.to,e.to,e.endY,parts[i+e.components-1].geometry]]){
        const poly=hull(g),cap=poly.map((a,j)=>({a,b:poly[(j+1)%poly.length],gap:pointSegmentDistance(...p,a,poly[(j+1)%poly.length])})).sort((a,b)=>a.gap-b.gap)[0];assert(cap.gap<.012);assert(Math.hypot(cap.b[0]-cap.a[0],cap.b[1]-cap.a[1])>=2.35,'a network path is too narrow at its actual cap');
        if(id===q.from&&q.walkFrom){const walk=parts.find(p=>{const w=p.geometry.userData.islandMassifLandingWalk;return w?.runId===id&&Math.hypot(w.from[0]-q.walkFrom[0],w.from[1]-q.walkFrom[1])<.001;});assert(walk,'a contour stair lacks its physical upper connecting walk');const w=walk.geometry.userData.islandMassifLandingWalk;assert(parts.some(p=>p.geometry.userData.islandMassifLanding&&onTop(p.geometry,e.from,e.startY)&&onTop(p.geometry,w.to,e.startY)),'a stair and its upper connecting walk must meet the same actual landing');continue;}
        const surfaces=id===network.arrival?arrivals:terraces.get(id)||[];
        for(const f of [.1,.5,.9]){const point=[cap.a[0]+(cap.b[0]-cap.a[0])*f,cap.a[1]+(cap.b[1]-cap.a[1])*f];assert(surfaces.some(s=>onTop(s,point,y)),`${town}: ${id} is not the actual terrace at a claimed network endpoint`);}
      }
      edges.push(q);
    }
    const reached=new Set([network.arrival]);for(let pass=0;pass<=terraces.size;pass++){const before=reached.size;for(const e of edges){if(reached.has(e.from))reached.add(e.to);if(reached.has(e.to))reached.add(e.from);}if(reached.size===before)break;}
    const stranded=[...occupied].filter(id=>!reached.has(id));assert.equal(stranded.length,0,`${town} has stranded occupied terraces: ${stranded.join(', ')}`);
    assert([...terraces.keys()].every(id=>reached.has(id)),`${town} retains an unreachable empty promenade`);
    // Cutting all edges incident to a real occupied run must make the same graph
    // oracle fail, demonstrating that the arrival node is not assumed reachable.
    const cut=[...occupied][0],testEdges=edges.filter(e=>e.from!==cut&&e.to!==cut),testReached=new Set([network.arrival]);for(let k=0;k<=terraces.size;k++)for(const e of testEdges){if(testReached.has(e.from))testReached.add(e.to);if(testReached.has(e.to))testReached.add(e.from);}assert(!testReached.has(cut),'an isolated occupied run must fail connectivity');
    coverage.push({town,occupiedRuns:occupied.size,reachableOccupiedRuns:occupied.size-stranded.length,terraceRuns:terraces.size,reachableRuns:[...terraces.keys()].filter(id=>reached.has(id)).length,physicalLinks:edges.length});
  }
  stats.massifNetworkCoverage=coverage;
});
check('generated island tree crowns clear actual road ribbon footprints',()=>{
  const grid=new Map(),polys=[];
  for(const {name,geometry:g}of result.auditParts){const road=g.userData.islandRoad;if(!road||!name.includes('island city'))continue;const p=g.attributes.position;
    for(let i=0;i<g.index.count;i+=3){if(g.attributes.aFacade.getZ(g.index.getX(i))!==(road.kind??9))continue;const ids=[0,1,2].map(k=>g.index.getX(i+k)),q=ids.map(k=>[p.getX(k),p.getZ(k)]),cross=(q[1][1]-q[0][1])*(q[2][0]-q[0][0])-(q[1][0]-q[0][0])*(q[2][1]-q[0][1]);if(cross<=1e-7)continue;polys.push(q);
      for(let x=Math.floor((Math.min(...q.map(p=>p[0]))-35)/100);x<=Math.floor((Math.max(...q.map(p=>p[0]))+35)/100);x++)for(let z=Math.floor((Math.min(...q.map(p=>p[1]))-35)/100);z<=Math.floor((Math.max(...q.map(p=>p[1]))+35)/100);z++){const k=x+','+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(q);}
    }
  }
  const hits=(x,z,r,q)=>{const crosses=q.map((a,i)=>{const b=q[(i+1)%q.length];return(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);});return crosses.every(v=>v>=0)||crosses.every(v=>v<=0)||q.some((a,i)=>pointSegmentDistance(x,z,a,q[(i+1)%q.length])<r);};
  assert(hits(...polys[0][0],1,polys[0]));assert(!hits(polys[0][0][0]+10000,polys[0][0][1],1,polys[0]));
  const trees=planIslandTrees(result.isFree);assert(trees.length>10000);
  for(const t of trees){const r=SPECIES[t.sp].shape[2]*t.s*.5;assert(!(grid.get(Math.floor(t.x/100)+','+Math.floor(t.z/100))||[]).some(q=>hits(t.x,t.z,r,q)),`tree crown cuts a road at ${t.x},${t.z}`);}
  stats.islandTrees=trees.length;stats.crownRoadIntersections=0;
});
check('human-scale stair risers and finite geometry budget',()=>{
  for(const {geometry:g}of result.auditParts)if(g.userData.islandStair)assert(g.userData.islandStair.riser<=.281);
  assert(result.tris<7500000,`island/massif geometry exceeded provisional 7.5M static guardrail: ${result.tris}`);
  assert(SKYLINE_KEEPOUT.length>100,'vegetation keep-outs must include the new landscape');
});
console.log(JSON.stringify({checks,stats},null,2));
console.log('ISLANDS_VERIFIED');
