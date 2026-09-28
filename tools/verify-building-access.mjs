import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBuildings } from '../src/world/buildings.js';
import { wardRecords, planWard, wardTowerDefs, wardHeight } from '../src/world/metro.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { terrainHeight } from '../src/world/terrain.js';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';

// The oracle extracts the production building faces, rather than accepting the
// builder's declared stair count or a nominal doorway. All 18 actual institutions
// are rebuilt at their real seed/dimensions, then tested in their own rigid frame.
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),metrics={institutions:0,lods:0,walkingIntervals:0,floorCoverageRectangles:0,maxRiser:0,minTread:Infinity,triangles:0};
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
function clip(poly,a,b,sign,inside){const out=[],side=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))*(inside?1:-1);for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],u=side(p),v=side(q);if(u>=0)out.push(p);if(u*v<0){const t=u/(u-v);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}return out;}
function subtract(poly,cover){const sign=cover.reduce((s,a,i)=>{const b=cover[(i+1)%cover.length];return s+a[0]*b[1]-a[1]*b[0];},0)>=0?1:-1,out=[];let remaining=poly;for(let i=0;i<cover.length&&remaining.length>=3;i++){const a=cover[i],b=cover[(i+1)%cover.length],outside=clip(remaining,a,b,sign,false);if(outside.length>=3&&area(outside)>1e-9)out.push(outside);remaining=clip(remaining,a,b,sign,true);}return out;}
function faces(g){const p=g.attributes.position,out=[];for(let i=0;i<g.index.count;i+=3){const t=[0,1,2].map(k=>V().fromBufferAttribute(p,g.index.getX(i+k))),normal=new THREE.Triangle(...t).getNormal(V());out.push({t,normal,index:i});}return out;}
function floorAt(list,x,z,ceiling){const ray=new THREE.Ray(V(x,ceiling,z),V(0,-1,0)),hit=V();let y=-Infinity;for(const f of list)if(f.normal.y>.95&&ray.intersectTriangle(...f.t,false,hit)&&hit.y>y)y=hit.y;return y;}
function box(x0,x1,y0,y1,z0,z1){return solidComponents(new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0).translate((x0+x1)/2,(y0+y1)/2,(z0+z1)/2))[0];}
function coverage(list,x0,x1,z0,z1,y){let uncovered=[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]];for(const f of list)if(f.normal.y>.999&&f.t.every(p=>Math.abs(p.y-y)<.0002)){const cover=f.t.map(p=>[p.x,p.z]);uncovered=uncovered.flatMap(p=>subtract(p,cover));if(!uncovered.length)break;}return uncovered.reduce((s,p)=>s+area(p),0);}
function inspect(g,L,{count=true}={}){
 const all=faces(g),solids=solidComponents(g),college=L.type==='college',width=college?3.2:1.6;
 const outside=L.d/2+(college?.9:4.0),inside=L.d/2-(college?12:7.9),ground=L.lo,ceiling=ground+3;
 // Partition the exact walking strip at all projected mesh edge events. Horizontal
 // floors must cover each complete rectangle, not only its centre or sample rays.
 const cuts=[outside,inside];for(const f of all)for(let i=0;i<3;i++){const a=f.t[i],b=f.t[(i+1)%3];if(a.y>ceiling+.01||b.y>ceiling+.01)continue;for(const x of [-width/2,0,width/2])if((a.x-x)*(b.x-x)<=0&&Math.abs(a.x-b.x)>1e-8){const t=(x-a.x)/(b.x-a.x),z=a.z+(b.z-a.z)*t;if(z>inside&&z<outside)cuts.push(z);}if(Math.abs(a.x)<=width/2&&a.z>inside&&a.z<outside)cuts.push(a.z);}
 cuts.sort((a,b)=>b-a);const boundaries=cuts.filter((z,i)=>!i||cuts[i-1]-z>1e-5),runs=[];
 for(let i=0;i<boundaries.length-1;i++){const z1=boundaries[i],z0=boundaries[i+1];if(z1-z0<1e-5)continue;const y=Math.max(ground,floorAt(all,0,(z0+z1)/2,ceiling));assert.ok(Number.isFinite(y)&&y<=ground+1.66,'Floor lies on public threshold, not upper roof');
  // Only the surveyed ground outside the building's toe may supply a floor.
  const groundZone=college?z0>=L.d/2+.6-1e-5:z0>=L.d/2+3.7-1e-5;
  if(!groundZone||y>ground+.001)assert.ok(coverage(all,-width/2+.002,width/2-.002,z0+.0001,z1-.0001,y)<1e-5,`${L.type}: continuous actual floor missing at z=${z0}..${z1}, y=${y}`);
  const body=box(-width/2+.002,width/2-.002,y+.015,y+2.1,z0+Math.min(.002,(z1-z0)/4),z1-Math.min(.002,(z1-z0)/4));

  assert.ok(!solids.some(c=>materialContact(c,body,.00001)),`${L.type}: walking headroom obstructed at ${z0}..${z1}`);
  if(runs.length&&Math.abs(runs.at(-1).y-y)<.0001)runs.at(-1).end=z0;else runs.push({start:z1,end:z0,y});
  if(count){metrics.walkingIntervals++;metrics.floorCoverageRectangles++;}
 }
 assert.ok(runs.length>=3,'Actual entrance has ground, treads and landing');
 for(let i=1;i<runs.length;i++){const rise=runs[i].y-runs[i-1].y;assert.ok(rise>0&&rise<=.1802,`Unusable actual riser ${rise}`);if(count)metrics.maxRiser=Math.max(metrics.maxRiser,rise);}
 for(const r of runs.slice(1,-1)){const tread=r.start-r.end;assert.ok(tread>=.2998,`Short actual tread ${tread}`);if(count)metrics.minTread=Math.min(metrics.minTread,tread);}
 assert.ok(Math.abs(runs.at(-1).y-(ground+(college?.25:1.65)))<.0002,'Public route reaches institution datum');
 return {runs,all,solids,width,inside,outside};
}
const towers=buildTowers(wardTowerDefs(),(x,z)=>Math.max(wardHeight(x,z),terrainHeight(x,z)),new THREE.Scene());for(const t of towers)t.footprint=towerFootprint(t,100);
let collegeFixture,museumFixture;
for(const rec of wardRecords().filter(r=>['aurora','westmere'].includes(r.w.id))){const P=planWard(rec,towers);for(const original of P.lots.filter(l=>['college','museum'].includes(l.type))){
 const L={...original,x:0,z:0,rot:0,lo:original.y,hi:original.y,dk:'ward',district:rec.w.id};
 const built=buildBuildings(new THREE.Scene(),{lots:[L],districts:[{id:rec.w.id,kind:'ward',x:0,z:0}]},()=>L.lo,{lowrise:1});
 metrics.institutions++;for(const m of built.meshes){const a=auditGeometry(m.geometry,{tolerance:1e-4});assert.equal(a.boundaryEdges+a.inconsistentEdges+a.nonFinite+a.invalidNormals,0,'Every public threshold remains closed and finite');inspect(m.geometry,L);metrics.lods++;metrics.triangles+=m.geometry.index.count/3;}
 if(L.type==='college'&&!collegeFixture)collegeFixture={g:built.meshes[0].geometry,L};if(L.type==='museum'&&!museumFixture)museumFixture={g:built.meshes[0].geometry,L};
 }}
assert.equal(metrics.institutions,18,'Every eight Aurora college and ten Westmere museum institutions included');assert.equal(metrics.lods,36);
// A real blocked-gate mesh must fail the same public-route oracle, including
// whole-solid containment; adding material outside the passage must still pass.
const cf=collegeFixture;
function withBox(g,parameters,position){const source=g.clone();for(const name of Object.keys(source.attributes))if(!['position','normal'].includes(name))source.deleteAttribute(name);const addition=new THREE.BoxGeometry(...parameters).translate(...position);addition.deleteAttribute('uv');return mergeGeometries([source,addition]);}
const blocked=withBox(cf.g,[6,7,1],[0,cf.L.lo+3.5,cf.L.d/2-3.5]);
assert.throws(()=>inspect(blocked,cf.L,{count:false}),/headroom|Floor|floor/,'Actual gate wall obstructs the production passage');
const enclosing=withBox(cf.g,[20,10,20],[0,cf.L.lo+4,cf.L.d/2-5]);
assert.throws(()=>inspect(enclosing,cf.L,{count:false}),/headroom|Floor|floor/,'A wholly enclosing solid also fails');
const clearAddition=withBox(cf.g,[1,1,1],[20,cf.L.lo+2,cf.L.d/2+6]);inspect(clearAddition,cf.L,{count:false});
// Remove the first museum tread top, preserving all other production geometry.
const mf=museumFixture,mg=mf.g.clone(),firstY=mf.L.lo+.165,idx=[];let removed=0;for(const f of faces(mg)){if(f.normal.y>.99&&f.t.every(p=>Math.abs(p.y-firstY)<.0002)){removed++;continue;}idx.push(...mg.index.array.slice(f.index,f.index+3));}assert.ok(removed>0);mg.setIndex(idx);assert.throws(()=>inspect(mg,mf.L,{count:false}),/floor|riser|tread/i,'Missing actual first tread cannot pass');
console.log(JSON.stringify(metrics));console.log('BUILDING_ACCESS_VERIFIED');
