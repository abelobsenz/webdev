import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { HeightSampler, buildTerrainData, buildInnerGeometry, terrainHeight, INNER } from '../src/world/terrain.js';

const heights=await buildTerrainData(),geometry=buildInnerGeometry(heights),sampler=new HeightSampler(heights);
const p=geometry.attributes.position,indices=geometry.index,step=INNER.half*2/INNER.n,stride=INNER.n+1;
const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0)),hit=new THREE.Vector3(),vertices=Array.from({length:3},()=>new THREE.Vector3());
const samples=[[.5,.5],[.18,.23],[.77,.18],[.22,.83],[.81,.76]];
let checks=0,maxError=0,oldFailures=0,oldLandFailures=0,oldLandMaxError=0,worst;
for(let j=0;j<INNER.n;j++)for(let i=0;i<INNER.n;i++)for(const [u,v]of samples){
 const x=-INNER.half+(i+u)*step,z=-INNER.half+(j+v)*step;
 ray.origin.set(x,1e4,z);let y;
 for(let t=0;t<2;t++){
  const start=(j*INNER.n+i)*6+t*3;
  for(let k=0;k<3;k++)vertices[k].fromBufferAttribute(p,indices.getX(start+k));
  if(ray.intersectTriangle(...vertices,false,hit)){y=hit.y;break;}
 }
 assert.ok(Number.isFinite(y),'Every tested ground column intersects its real rendered cell');
 const actual=sampler.get(x,z),error=Math.abs(y-actual);
 if(error>maxError){maxError=error;worst={x,z,rendered:y,sampled:actual,error};}
 const at=j*stride+i,old=(heights[at]*(1-u)+heights[at+1]*u)*(1-v)+(heights[at+stride]*(1-u)+heights[at+stride+1]*u)*v;
 const oldError=Math.abs(y-old);if(oldError>.001)oldFailures++;
 if(y>0){oldLandMaxError=Math.max(oldLandMaxError,oldError);if(oldError>.01)oldLandFailures++;}
 checks++;
}
let vertexChecks=0,borderChecks=0;
for(let j=0;j<=INNER.n;j+=8)for(let i=0;i<=INNER.n;i+=8){
 const at=j*stride+i;assert.ok(Math.abs(sampler.get(p.getX(at),p.getZ(at))-p.getY(at))<.0001,'Sampled grid vertices preserve rendered height');vertexChecks++;
}
for(let k=0;k<=INNER.n;k+=4)for(const [i,j]of [[k,0],[k,INNER.n],[0,k],[INNER.n,k]]){
 const at=j*stride+i;assert.ok(Math.abs(sampler.get(p.getX(at),p.getZ(at))-p.getY(at))<.0001,'All four borders agree with rendered terrain');borderChecks++;
}
for(const [x,z]of [[-7201,0],[7201,0],[0,-7201],[0,7201],[10000,-12000],[-19000,-6000]])assert.equal(sampler.get(x,z),terrainHeight(x,z),'Outside the inner grid retains the analytic fallback');
const digest=array=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
console.log(JSON.stringify({checks,maxError,worst,vertexChecks,borderChecks,oldFailures,oldLandFailures,oldLandMaxError,vertices:p.count,triangles:indices.count/3,positionSha256:digest(p.array),indexSha256:digest(indices.array)},null,2));
assert.ok(oldFailures>1e5&&oldLandFailures>1e5&&oldLandMaxError>1,'The preserved bilinear formula reproduces material land-support errors');
assert.ok(maxError<1e-7,'Placement sampler agrees with real alternating rendered triangles, including off-centre points');
assert.equal(indices.count/3,INNER.n*INNER.n*2,'No additional terrain triangles');
console.log('TERRAIN_SUPPORT_VERIFIED');
