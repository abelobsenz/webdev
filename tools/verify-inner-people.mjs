import assert from 'node:assert/strict';
import * as THREE from 'three';
import { People } from '../src/life/people.js';
import { buildAxis } from '../src/world/axis.js';
import { buildInfrastructure } from '../src/world/infrastructure.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { PLAZA_Y } from '../src/world/layout.js';

// Independent mesh oracle: actual transformed triangles, Three ray/triangle and
// triangle/box tests. No production path blockers or copied surface equations.
function indexMeshes(meshes) {
 const cells=new Map(),cell=29,ray=new THREE.Ray(),hit=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0);
 let triangles=0,top=-Infinity;
 for(const mesh of meshes){
  mesh.updateMatrixWorld(true);const p=mesh.geometry.attributes.position,ix=mesh.geometry.index;
  for(let i=0;i<(ix?.count??p.count);i+=3){
   const vs=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,ix?ix.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
   if(Math.min(...vs.map(v=>v.y))>120)continue;
   const tri=new THREE.Triangle(...vs),normal=tri.getNormal(new THREE.Vector3()),bounds=new THREE.Box3().setFromPoints(vs);
   const t={tri,normal,bounds,name:mesh.name||`structural mesh ${mesh.id}`};triangles++;top=Math.max(top,bounds.max.y);
   for(let x=Math.floor(bounds.min.x/cell);x<=Math.floor(bounds.max.x/cell);x++)for(let z=Math.floor(bounds.min.z/cell);z<=Math.floor(bounds.max.z/cell);z++){
    const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);
   }
  }
 }
 const list=(x,z)=>cells.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)||[];
 return {triangles,
  support(x,y,z){x+=.000017;z+=.000011;ray.origin.set(x,y+.05,z);ray.direction.copy(down);let best=-Infinity,name;
   for(const t of list(x,z))if(t.normal.y>.25&&ray.intersectTriangle(t.tri.a,t.tri.b,t.tri.c,false,hit)&&hit.y>best){best=hit.y;name=t.name;}
   return {y:best,name};
  },
  occupied(x,y,z,r=.7){
   const box=new THREE.Box3(new THREE.Vector3(x-r,y+.12,z-r),new THREE.Vector3(x+r,y+2.1,z+r)),seen=new Set();
   for(let u=Math.floor((x-r)/cell);u<=Math.floor((x+r)/cell);u++)for(let v=Math.floor((z-r)/cell);v<=Math.floor((z+r)/cell);v++)for(const t of cells.get(`${u},${v}`)||[]){
    if(seen.has(t))continue;seen.add(t);if(box.intersectsBox(t.bounds)&&box.intersectsTriangle(t.tri))return t.name;
   }
   // Signed crossings also detect a body fully inside a large closed solid.
   ray.origin.set(x+.000013,top+1,z+.000019);ray.direction.copy(down);const hits=[];
   for(const t of list(x,z))if(Math.abs(t.normal.y)>1e-10&&ray.intersectTriangle(t.tri.a,t.tri.b,t.tri.c,false,hit)&&hit.y>y+.12)hits.push([hit.y,Math.sign(t.normal.y),t.name]);
   hits.sort((a,b)=>b[0]-a[0]);let winding=0,last;
   for(const [h,s,name]of hits){if(h<y+2.1&&winding>0)return last;winding+=s;last=name;}
   return winding>0?last:null;
  }
 };
}
const sampler=new HeightSampler(await buildTerrainData(()=>{}));
const ground=(x,z)=>Math.max(0,sampler.get(x,z));
const scene=new THREE.Scene(),world={settings:{people:true,lowrise:1},groundHeight:ground};
world.axis=buildAxis(scene,[]);world.infra=buildInfrastructure(scene,ground,(x,z)=>sampler.get(x,z));scene.updateMatrixWorld(true);
const structural=[],water=[];
scene.traverse(m=>{if(!m.isMesh||m.isInstancedMesh||!m.geometry?.attributes.position)return;
 if(m.name==='Axis plaza pools')water.push(m);
 if(!m.material.transparent||m.name==='Axis plaza box')structural.push(m);
});
const oracle=indexMeshes(structural),waterOracle=indexMeshes(water);
const people=new People(scene,world.settings,world),texture=people.pathTex.image,rows=new Map();
for(const m of people.meshes.filter(m=>m.userData.far)){
 const p=m.geometry.attributes.aP0,q=m.geometry.attributes.aP1;
 for(let i=0;i<p.count;i++){
  const row=p.getX(i),r=rows.get(row)||{name:m.name,half:0,length:q.getW(i),closed:q.getZ(i)>9.5};
  r.half=Math.max(r.half,Math.abs(p.getW(i)));rows.set(row,r);
 }
}
function at(row,u,L){
 const n=Math.max(1,Math.ceil(L*.5)),s=THREE.MathUtils.clamp(u,0,1)*n,i=Math.floor(s),f=s-i,a=(row*texture.width+i)*4,b=(row*texture.width+Math.min(n,i+1))*4;
 return Array.from({length:4},(_,k)=>texture.data[a+k]*(1-f)+texture.data[b+k]*f);
}
const reports=new Map();
for(const [row,r]of rows){
 const report=reports.get(r.name)||{name:r.name,rows:0,samples:0,collision:0,water:0,unsupported:0,maxSupportError:0,examples:{}};reports.set(r.name,report);report.rows++;
 const n=Math.ceil(r.length/2);
 for(let k=0;k<=n;k++){
  const u=k/n,p=at(row,u,r.length),wrap=v=>r.closed?((v%1)+1)%1:v,a=at(row,wrap(u-1.5/r.length),r.length),b=at(row,wrap(u+1.5/r.length),r.length),dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1,nx=dz/length,nz=-dx/length,grade=(b[1]-a[1])/length;
  const cross=Math.ceil(r.half*2/1.2);
  for(let j=0;j<=cross;j++){
   const lane=-r.half+2*r.half*j/cross,dEnd=r.closed?1e4:Math.min(u,1-u)*r.length,fade=THREE.MathUtils.smoothstep(dEnd,0,THREE.MathUtils.clamp(Math.abs(lane)*1.5,1.5,10)),lat=lane*fade;
   const x=p[0]+nx*lat,y=p[1]+p[3]*lat,z=p[2]+nz*lat;report.samples++;
   const collision=oracle.occupied(x,y,z),wet=waterOracle.support(x,y+1,z).y>y-.1;
   let error=0;
   for(const [fx,fz]of [[0,0],[.65,.65],[-.65,.65],[.65,-.65],[-.65,-.65]]){
    const expected=y+p[3]*(fx*nx+fz*nz)+grade*(fx*dx+fz*dz)/length,surface=oracle.support(x+fx,expected,z+fz).y;
    error=Math.max(error,Math.abs(expected-.002-surface));
   }
   report.maxSupportError=Math.max(report.maxSupportError,error);
   for(const [key,bad]of Object.entries({collision,water:wet,unsupported:error>.02}))if(bad){report[key]++;if(!report.examples[key])report.examples[key]={row,u,x,y,z,lane,error,object:collision};}
  }
 }
}
console.log(JSON.stringify({people:people.total,triangles:oracle.triangles,groups:[...reports.values()]},null,2));
if(!process.argv.includes('--audit-only')){
 for(const r of reports.values())for(const key of ['collision','water','unsupported'])assert.equal(r[key],0,`${r.name} ${key}`);
 console.log('INNER_PEOPLE_VERIFIED');
}
