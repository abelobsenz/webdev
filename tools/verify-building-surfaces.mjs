import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { Builder, KIND, buildBuildings } from '../src/world/buildings.js';

// Independent emitted-triangle test: intersect real upward horizontal faces in
// plan, and ray-test their shared patch against the rest of the actual roof.
// Opposing faces at a structural contact are deliberately not a conflict.
const EPS=1e-5;
function clip(subject, triangle) {
  let out=subject.map(p=>p.slice());
  const area=triangle.reduce((s,a,i)=>{const b=triangle[(i+1)%3];return s+a[0]*b[1]-a[1]*b[0]},0);
  for(let i=0;i<3;i++){
    const a=triangle[i],b=triangle[(i+1)%3],sign=area>=0?1:-1;
    const side=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
    const input=out;out=[];
    for(let j=0;j<input.length;j++){
      const p=input[j],q=input[(j+1)%input.length],sp=side(p),sq=side(q);
      if(sp>=-EPS)out.push(p);
      if((sp>EPS&&sq< -EPS)||(sp< -EPS&&sq>EPS)) {const t=sp/(sp-sq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    if(out.length<3)return [];
  }
  return out;
}
function area(p){return Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0]},0))/2;}
function barycentric(t,x,z){const a=t[0],b=t[1],c=t[2],d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(d)<1e-10)return null;const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d;return [u,v,1-u-v];}
function halfPlane(poly,a,b,sign,inside=true){
  const side=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))*(inside?1:-1),out=[];
  for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],sp=side(p),sq=side(q);if(sp>=0)out.push(p);if((sp>0&&sq<0)||(sp<0&&sq>0)){const u=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u]);}}
  return out;
}
function subtractConvex(poly,cover){
  const sign=cover.reduce((s,a,i)=>{const b=cover[(i+1)%cover.length];return s+a[0]*b[1]-a[1]*b[0]},0)>=0?1:-1;
  let remaining=poly;const outside=[];
  for(let i=0;i<cover.length&&remaining.length>=3;i++){
    const a=cover[i],b=cover[(i+1)%cover.length],part=halfPlane(remaining,a,b,sign,false);
    if(part.length>=3&&area(part)>1e-8)outside.push(part);
    remaining=halfPlane(remaining,a,b,sign,true);
  }
  return outside;
}
function abovePlane(t,y){const out=[];for(let i=0;i<3;i++){const p=t[i],q=t[(i+1)%3],sp=p[1]-y,sq=q[1]-y;if(sp>=0)out.push([p[0],p[2]]);if((sp>0&&sq<0)||(sp<0&&sq>0)){const u=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*u,p[2]+(q[2]-p[2])*u]);}}return out;}
export function auditRoofSurfaces(geometry) {
  geometry.computeBoundingBox();
  const p=geometry.attributes.position,f=geometry.attributes.aFacade,idx=geometry.index?.array||Array.from({length:p.count},(_,i)=>i),up=[],horizontal=[];
  for(let i=0;i<idx.length;i+=3){
    const ids=[idx[i],idx[i+1],idx[i+2]],t=ids.map(k=>[p.getX(k),p.getY(k),p.getZ(k)]),a=t[0],b=t[1],c=t[2];
    const ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);if(ny<1e-8)continue;
    const row={t,ids,i:i/3,kind:Math.round(f?.getZ(ids[0])??0),y:a[1],minX:Math.min(...t.map(v=>v[0])),maxX:Math.max(...t.map(v=>v[0])),minZ:Math.min(...t.map(v=>v[2])),maxZ:Math.max(...t.map(v=>v[2]))};up.push(row);
    if(Math.max(...t.map(v=>v[1]))-Math.min(...t.map(v=>v[1]))<1e-4)horizontal.push(row);
  }
  const levels=new Map();for(const t of horizontal){const key=Math.round(t.y*10000);if(!levels.has(key))levels.set(key,[]);levels.get(key).push(t);}
  let candidatePairs=0,hidden=0,equivalent=0,quantizationSeams=0;const conflicts=[];
  const coordinateScale=Math.max(1,...geometry.boundingBox.min.toArray().map(Math.abs),...geometry.boundingBox.max.toArray().map(Math.abs));
  const seamTolerance=coordinateScale*2**-22+1e-7;
  function width(poly){let value=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<1e-10)continue;const d=poly.map(p=>((b[1]-a[1])*(p[0]-a[0])-(b[0]-a[0])*(p[1]-a[1]))/l);value=Math.min(value,Math.max(...d)-Math.min(...d));}return value;}
  for(const triangles of levels.values())for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){
    const a=triangles[i],b=triangles[j];if(a.maxX<=b.minX+EPS||b.maxX<=a.minX+EPS||a.maxZ<=b.minZ+EPS||b.maxZ<=a.minZ+EPS)continue;
    const patch=clip(a.t.map(v=>[v[0],v[2]]),b.t.map(v=>[v[0],v[2]])),patchArea=area(patch);if(patchArea<1e-5)continue;candidatePairs++;
    if(width(patch)<=seamTolerance){quantizationSeams++;continue;}
    // Subtract every actual higher upward face. This checks the complete
    // shared polygon, including a narrow exposed patch beside roof furniture.
    let exposedPatches=[patch];
    for(const q of up){
      if(q.i===a.i||q.i===b.i||Math.max(...q.t.map(p=>p[1]))<=a.y+.005||q.maxX<a.minX||q.minX>a.maxX||q.maxZ<a.minZ||q.minZ>a.maxZ)continue;
      const cover=abovePlane(q.t,a.y+.005);if(cover.length<3||area(cover)<1e-8)continue;
      exposedPatches=exposedPatches.flatMap(p=>subtractConvex(p,cover));
      if(!exposedPatches.length)break;
    }
    exposedPatches=exposedPatches.filter(p=>area(p)>1e-5&&width(p)>seamTolerance);
    if(!exposedPatches.length){hidden++;continue;}
    const largest=exposedPatches.reduce((a,b)=>area(a)>area(b)?a:b),exposed=[largest.reduce((s,p)=>s+p[0],0)/largest.length,largest.reduce((s,p)=>s+p[1],0)/largest.length];
    if(a.kind===b.kind){
      const sample=row=>{const weights=barycentric(row.t,...exposed);return ['aFacade','aInst'].flatMap(name=>{const attr=geometry.attributes[name];if(!attr)return[];return Array.from({length:attr.itemSize},(_,axis)=>row.ids.reduce((s,id,k)=>s+attr.array[id*attr.itemSize+axis]*weights[k],0));});};
      const av=sample(a),bv=sample(b);
      if(av.every((v,i)=>Math.abs(v-bv[i])<seamTolerance*4)){equivalent++;continue;}
    }
    conflicts.push({triangles:[a.i,b.i],kinds:[a.kind,b.kind],y:a.y,area:patchArea,exposedArea:exposedPatches.reduce((n,p)=>n+area(p),0),point:[exposed[0],a.y,exposed[1]]});
  }
  return {triangles:idx.length/3,upwardFaces:up.length,horizontalFaces:horizontal.length,candidatePairs,hidden,equivalent,quantizationSeams,seamTolerance,conflicts};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const families=['ribbon','terrace','cloister','tower','pavilion','mews','stack','crystal','college','canal','arcade','solar','ziggurat','warehouse','reef','mansion','gallery','museum'];
const rows=[];
for(const type of families)for(const [w,d,floors,seed] of [[60,50,6,3],[28,24,4,41],[17,19,8,127],[44,37,12,57]]) {
  const lot={x:1800,z:-2300,w,d,lo:23.7,hi:23.7,rot:.371,type,floors,seed,dk:'ward',district:'fixture',centre:.5};
  const city=buildBuildings(new THREE.Scene(),{lots:[lot],districts:[{id:'fixture',kind:'ward',x:1800,z:-2300}]},()=>23.7,{lowrise:.75});
  for(const [lod,mesh] of city.meshes.entries())rows.push({type,seed,w,d,floors,lod,...auditRoofSurfaces(mesh.geometry)});
  city.meshes.forEach(m=>m.geometry.dispose());city.meshes[0].material.dispose();
}
const control=new Builder();control.box(-4,4,-4,4,0,4,KIND.STONE,KIND.STONE);control.box(-5,5,-5,5,3.65,4,KIND.STONE,KIND.GARDEN);
assert.ok(auditRoofSurfaces(control.geometry()).conflicts.length>0,'coplanar planted roof control is detected');
const joined=new Builder();joined.box(-4,4,-4,4,0,3.65,KIND.STONE,KIND.STONE);joined.box(-5,5,-5,5,3.65,4,KIND.STONE,KIND.GARDEN);
assert.equal(auditRoofSurfaces(joined.geometry()).conflicts.length,0,'opposed contact surfaces remain valid');
const wardFile=process.argv.find(a=>a.startsWith('--wards='))?.slice(8);
if(wardFile)for(const ward of JSON.parse(fs.readFileSync(wardFile))){
  const start=rows.length;
  for(const L of ward.lots){
    const lot={...L,x:ward.w.x+L.lx,z:ward.w.z+L.lz,lo:L.y,hi:L.y,dk:'ward',district:ward.id};
    const city=buildBuildings(new THREE.Scene(),{lots:[lot],districts:[{id:ward.id,kind:'ward',x:ward.w.x,z:ward.w.z}]},()=>L.y,{lowrise:.75});
    for(const [lod,mesh] of city.meshes.entries())rows.push({ward:ward.id,type:lot.type,seed:lot.seed,w:lot.w,d:lot.d,floors:lot.floors,lod,...auditRoofSurfaces(mesh.geometry)});
    city.meshes.forEach(m=>m.geometry.dispose());city.meshes[0].material.dispose();
  }
  console.log(JSON.stringify({ward:ward.id,buildings:ward.lots.length,conflicts:rows.slice(start).reduce((n,r)=>n+r.conflicts.length,0)}));
}
const summary={createdAt:new Date().toISOString(),rows,conflicts:rows.reduce((n,r)=>n+r.conflicts.length,0)};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify(summary,null,2));
console.log(JSON.stringify({fixtures:rows.length,conflicts:summary.conflicts,failures:rows.filter(r=>r.conflicts.length).map(r=>({type:r.type,seed:r.seed,lod:r.lod,count:r.conflicts.length,kinds:[...new Set(r.conflicts.map(c=>c.kinds.join('/')))]}))},null,2));
if(!process.argv.includes('--audit-only')){assert.equal(summary.conflicts,0,'unintended exposed coplanar roofing');console.log('BUILDING_SURFACES_VERIFIED');}

}
