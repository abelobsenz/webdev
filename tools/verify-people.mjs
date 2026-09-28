import assert from 'node:assert/strict';
import * as THREE from 'three';
import { People, civicOccupancy } from '../src/life/people.js';
import { buildMetro, wardTowerDefs, wardBridgePaths, wardHeight } from '../src/world/metro.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';

const auditOnly=process.argv.includes('--audit-only');
// Optional hardware check evaluates the actual production vertex hook through
// WebGL transform feedback; no hand-copied replacement gait serves as its oracle.
if(process.argv.includes('--gpu')) {
 const fs=await import('node:fs'),path=await import('node:path'),{pathToFileURL}=await import('node:url');
 const at=process.argv.indexOf('--gpu'),build=path.resolve(process.argv[at+1]),output=process.argv[at+2];
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();page.setDefaultTimeout(300000);await page.goto(pathToFileURL(build).href+'?capture&quality=medium');
  await page.waitForFunction(()=>window.meridian?.world?.people);
  const report=await page.evaluate(()=>{
   const people=window.meridian.world.people,canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
   if(!gl)throw new Error('WebGL2 required');
   const rows=[],jointCases=[];
   for(const far of [false,true]){
    const mesh=people.meshes.find(m=>m.userData.far===far),g=mesh.geometry,hooks=mesh.material.userData.hooks;
    const vs=`#version 300 es\nprecision highp float;\nuniform float uTime;uniform vec3 cameraPosition;\nin vec3 position;\n${hooks.vertex.pars.replaceAll('attribute ','in ').replaceAll('varying ','out ')}\nuniform float testPhase;uniform float testSwing;uniform float testIdle;uniform vec2 testBuild;uniform vec2 testGrade;out vec3 measured;void main(){pPhase=testPhase;pSwing=testSwing;pIdle=testIdle;pBuild=testBuild;pGrade=testGrade;vVar=mod(aP1.z,10.0);measured=articulate(position,false)*(aP1.y/1.75);gl_Position=vec4(0,0,0,1);}`;
    const fs='#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1);}';
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.transformFeedbackVaryings(program,['measured'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    for(const name of ['position','aPart']){const a=g.attributes[name],b=gl.createBuffer(),loc=gl.getAttribLocation(program,name);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,a.array,gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,a.itemSize,gl.FLOAT,false,0,0);}
    const buffer=gl.createBuffer(),data=new Float32Array(g.attributes.position.count*3);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
    const uniform=(n,v)=>gl.uniform1f(gl.getUniformLocation(program,n),v),vec2=(n,v)=>gl.uniform2fv(gl.getUniformLocation(program,n),v);
    uniform('uFarSet',far?1:0);gl.enable(gl.RASTERIZER_DISCARD);
    const p0=g.attributes.aP0,p1=g.attributes.aP1,parts=g.attributes.aPart;
    let min=Infinity,max=-Infinity,radius=0,maxHeight=0,instances=0,samples=0;
    const tested=new Set(),jointSeeds=new Set();
    // Every variant, extremes of speed/height/build, and a deterministic spread
    // of real people are included; all sixty-four phases use rendered vertices.
    for(let j=0;j<p0.count;j+=Math.max(1,Math.floor(p0.count/64)))tested.add(j);
    for(let variant=0;variant<8;variant++)for(const key of ['height','speed']){
     const list=Array.from({length:p0.count},(_,i)=>i).filter(i=>Math.floor(p1.getZ(i)%10)===variant);
     list.sort((a,b)=>key==='height'?p1.getY(a)-p1.getY(b):Math.abs(p0.getZ(a))-Math.abs(p0.getZ(b)));if(list.length){tested.add(list[0]);tested.add(list.at(-1));if(key==='height')jointSeeds.add(list.at(-1));}
    }
    for(const j of tested){
     const seed=p1.getX(j),height=p1.getY(j),variant=p1.getZ(j)%10,speed=p0.getZ(j),idle=Math.abs(speed)<.05;
     const fract=x=>x-Math.floor(x),build=[.9+.22*fract(seed*5.93),.92+.16*fract(seed*8.31)];
     gl.vertexAttrib4f(gl.getAttribLocation(program,'aP1'),seed,height,variant,1);
     uniform('testSwing',idle?.04:Math.max(.2,Math.min(.5,Math.abs(speed)*.28)));uniform('testIdle',idle?1:0);vec2('testBuild',build);instances++;
     for(const grade of [[0,0],[.12,-.18],[-.22,.16]])for(let k=0;k<64;k++){
      uniform('testPhase',k*Math.PI/32);vec2('testGrade',grade);
      gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,g.attributes.position.count);gl.endTransformFeedback();gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
      let low=Infinity;
      for(let i=0;i<parts.count;i++){
       const part=parts.getX(i),x=data[i*3],y=data[i*3+1],z=data[i*3+2];
       if(!Number.isFinite(x+y+z))throw new Error('Nonfinite articulated vertex');
       maxHeight=Math.max(maxHeight,y-grade[0]*x-grade[1]*z);
       if(part===2||part===3)low=Math.min(low,y-grade[0]*x-grade[1]*z);
       if((part!==6||variant>=5)&&(part!==9||(variant>=2&&variant<=3)))radius=Math.max(radius,Math.hypot(x,z));
      }
      min=Math.min(min,low);max=Math.max(max,low);samples++;
      if(grade[0]===0&&grade[1]===0&&k%8===0&&jointSeeds.has(j)){
       const indices=[];
       for(let at=0;at<g.index.count;at+=3){const part=parts.getX(g.index.getX(at));if((part===6&&variant<5)||(part===8&&fract(seed*4.71)>.45)||(part===9&&(variant<2||variant>3)))continue;indices.push(g.index.getX(at),g.index.getX(at+1),g.index.getX(at+2));}
       const headVertices=[...new Set(indices)].filter(i=>[1,7,8].includes(parts.getX(i)));
       jointCases.push({far,seed,variant,phase:k,positions:Array.from(data),indices,headVertices});
      }
     }
    }
    gl.disable(gl.RASTERIZER_DISCARD);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Transform feedback readback failed');
    rows.push({far,instances,phases:64,grades:3,samples,minSoleFromSupportPlane:min,maxSoleFromSupportPlane:max,maxHorizontalRadius:radius,maxHeight});
   }
   return {rows,jointCases,renderer:gl.getParameter(gl.RENDERER)};
  });
  for(const r of report.rows){assert.ok(r.minSoleFromSupportPlane>-.00001&&r.maxSoleFromSupportPlane<.00001,'actual GPU shoes touch the support plane through the complete stride');assert.ok(r.maxHorizontalRadius>.4&&r.maxHorizontalRadius<.7&&r.maxHeight>1.5,'real articulated body vertices stay in audited clearance radius');}
  let jointSolids=0,jointControl=false;
  const disconnected=components=>{const reached=new Set([0]),queue=[0];for(let i=0;i<queue.length;i++)for(let j=0;j<components.length;j++)if(!reached.has(j)&&materialContact(components[queue[i]],components[j],.0001)){reached.add(j);queue.push(j);}return components.length-reached.size;};
  for(const c of report.jointCases){
   const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(c.positions,3));geometry.setIndex(c.indices);
   const solids=solidComponents(geometry,new THREE.Matrix4(),1e-6);jointSolids+=solids.length;
   assert.equal(disconnected(solids),0,`actual GPU body joints connect: far=${c.far}, variant=${c.variant}, phase=${c.phase}`);
   if(!jointControl){const detached=geometry.clone(),p=detached.attributes.position;for(const id of c.headVertices)p.setX(id,p.getX(id)+2);jointControl=disconnected(solidComponents(detached,new THREE.Matrix4(),1e-6))>0;}
  }
  assert.ok(jointControl,'A displaced head fails actual body material contact');
  report.joints={cases:report.jointCases.length,connectedSolids:jointSolids,displacedHeadDetected:jointControl};delete report.jointCases;
  console.log(JSON.stringify(report,null,2));if(output)fs.writeFileSync(output,JSON.stringify({build,...report},null,2));console.log('PEOPLE_GPU_VERIFIED');
 }finally{await browser.close();}
 process.exit(0);
}
// A separate implementation uses Three's ray/triangle intersection and the
// actual face normal. It verifies the production barycentric column index.
function solidProbe(meshes) {
 const cells=new Map(),size=37,down=new THREE.Vector3(0,-1,0),ray=new THREE.Ray(),hit=new THREE.Vector3();let top=-Infinity;
 for(const m of meshes){if(!m.isMesh||m.isInstancedMesh)continue;m.updateMatrixWorld(true);const p=m.geometry.attributes.position,ix=m.geometry.index;
  for(let i=0;i<(ix?.count??p.count);i+=3){const q=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,ix?ix.getX(i+k):i+k).applyMatrix4(m.matrixWorld));
   const normal=new THREE.Triangle(...q).getNormal(new THREE.Vector3());
   const t={q,triangle:new THREE.Triangle(...q),sign:Math.abs(normal.y)<1e-9?0:Math.sign(normal.y)};for(const v of q)top=Math.max(top,v.y);
   for(let x=Math.floor(Math.min(...q.map(v=>v.x))/size);x<=Math.floor(Math.max(...q.map(v=>v.x))/size);x++)for(let z=Math.floor(Math.min(...q.map(v=>v.z))/size);z<=Math.floor(Math.max(...q.map(v=>v.z))/size);z++){const k=`${x},${z}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(t);}
  }
 }
 return(x,y,z,height=2.1,radius=0)=>{
  // A different tiny offset avoids exact shared edges independently.
  x+=.000019;z+=.000003;const list=cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`);if(!list)return false;
  if(radius>0){
   const box=new THREE.Box3(new THREE.Vector3(x-radius,y+.12,z-radius),new THREE.Vector3(x+radius,y+height,z+radius)),seen=new Set();
   for(let cx=Math.floor((x-radius)/size);cx<=Math.floor((x+radius)/size);cx++)for(let cz=Math.floor((z-radius)/size);cz<=Math.floor((z+radius)/size);cz++)for(const t of cells.get(`${cx},${cz}`)||[]){if(seen.has(t))continue;seen.add(t);if(box.intersectsTriangle(t.triangle))return true;}
  }
  ray.origin.set(x,top+1,z);ray.direction.copy(down);const hits=[];
  for(const t of list)if(ray.intersectTriangle(...t.q,false,hit)&&hit.y>y+.12)hits.push([hit.y,t.sign]);
  hits.sort((a,b)=>b[0]-a[0]);let count=0;
  for(const [h,s]of hits){if(h<y+height&&count>0)return true;count+=s;}
  return count>0;
 };
}
const testMat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const fixtures=[new THREE.Mesh(new THREE.BoxGeometry(8,12,8).translate(0,6,0),testMat),new THREE.Mesh(new THREE.BoxGeometry(8,1,8).translate(20,7,0),testMat),new THREE.Mesh(new THREE.BoxGeometry(8,.4,8).translate(40,.2,0),testMat)];
const testColumn=civicOccupancy(fixtures),testProbe=solidProbe(fixtures);
for(const [x,y,z,want]of [[0,0,0,true],[0,7,0,true],[5,0,0,false],[20,0,0,false],[20,6.3,0,true],[40,0,0,true],[40,.4,0,false]])for(const check of [testColumn,testProbe])assert.equal(check(x,y,z),want,'solid interior, overhead clearance and raised plinth fixtures');
const narrow=new THREE.Mesh(new THREE.BoxGeometry(.12,3,.12).translate(1.1,1.5,.75),testMat),narrowProbe=civicOccupancy([narrow]);
assert.equal(narrowProbe(0,0,0),false);
assert.equal(narrowProbe(0,0,0,2.1,2.4),true,'whole body-clearance box catches a narrow post between former radial probes');
const reachPost=new THREE.Mesh(new THREE.BoxGeometry(.08,2,.08).translate(.56,1,.24),testMat),reachProbe=solidProbe([reachPost]);
assert.equal(reachProbe(0,0,0),false);
assert.equal(reachProbe(0,0,0,2.1,.7),true,'independent actual articulated-body box detects a post beyond the old .34m cardinal probes');
const sampler=new HeightSampler(await buildTerrainData(()=>{}));
const ground=(x,z)=>Math.max(0,sampler.get(x,z),wardHeight(x,z));
const scene=new THREE.Scene(),world={settings:{people:true,lowrise:1},colliders:[],reflectionHide:[],groundHeight:ground};
const towers=buildTowers(wardTowerDefs(),ground,scene);
for(const t of towers)t.footprint=towerFootprint(t,100);
world.metro=buildMetro(scene,towers,wardBridgePaths(ground),ground,world);
const civic=new Map(world.metro.wards.map(w=>{const far=new Set(w.landmarks.lod.map(l=>l.far));return[w,solidProbe(w.landmarks.meshes.filter(m=>!far.has(m)))];}));
const started=performance.now();
const people=new People(scene,world.settings,world);
const peopleBuildMs=performance.now()-started;
people.applyQuality({people:true,lowrise:.6});
let qualityRows=0,qualityMissing=0,oldPrefixMissing=0,qualityDrawn=0;
for(const m of people.meshes.filter(m=>m.userData.far&&m.name.startsWith('Citizens ward-')&&!m.name.startsWith('Citizens ward-deck'))){
 const p=m.geometry.attributes.aP0,full=new Map(),drawn=new Map(),old=new Map(),ordered=Array.from({length:p.count},(_,i)=>p.getX(i)).sort((a,b)=>a-b);
 for(let i=0;i<p.count;i++){const row=p.getX(i);full.set(row,(full.get(row)||0)+1);if(i<m.geometry.instanceCount)drawn.set(row,(drawn.get(row)||0)+1);}
 for(const row of ordered.slice(0,m.geometry.instanceCount))old.set(row,(old.get(row)||0)+1);
 for(const [row,n]of full)if(n>=4){qualityRows++;if(!drawn.has(row))qualityMissing++;if(!old.has(row))oldPrefixMissing++;}
 qualityDrawn+=m.geometry.instanceCount;
}
assert.equal(qualityMissing,0,'Medium preserves activity on every route with at least four planned people');
assert.ok(oldPrefixMissing>50,'old route-ordered prefix empties entire populated routes');
people.applyQuality(world.settings);
const body=[];
for(const far of [false,true]){
 const g=people.meshes.find(m=>m.userData.far===far).geometry,a=auditGeometry(g,{tolerance:1e-6});
 body.push({far,...a});
 assert.equal(a.boundaryEdges+a.nonManifoldEdges+a.inconsistentEdges+a.nonFinite+a.invalidNormals+a.degenerates,0,'complete body solid');
 assert.ok(a.signedVolume>0);
 assert.ok(a.triangles<(far?410:1420),'body closure does not inflate per-person triangle work');
}
assert.ok(auditGeometry(new THREE.CylinderGeometry(.1,.1,1,8,1,true),{tolerance:1e-6}).boundaryEdges>0,'open body part control');
const widths=new Map(),tex=people.pathTex.image;
for(const m of people.meshes.filter(m=>m.userData.far&&m.name.startsWith('Citizens ward-')&&!m.name.startsWith('Citizens ward-deck'))){
 const a=m.geometry.attributes.aP0,b=m.geometry.attributes.aP1;
 for(let i=0;i<a.count;i++){
  const row=a.getX(i),p=widths.get(row)||{half:0,length:b.getW(i),closed:b.getZ(i)>9.5};
  p.half=Math.max(p.half,Math.abs(a.getW(i)));widths.set(row,p);
 }
}
const pointAt=(row,u)=>{
 const steps=Math.max(1,Math.ceil(widths.get(row).length*.5)),x=Math.max(0,Math.min(1,u))*steps;
 const i=Math.floor(x),f=x-i,a=(row*tex.width+i)*4,b=(row*tex.width+Math.min(steps,i+1))*4;
 return [0,1,2,3].map(k=>tex.data[a+k]*(1-f)+tex.data[b+k]*f);
};
// Independently reconstruct the old256-point approximation from the actual
// corrected path. This must expose the original corner-cutting defect.
const coarseAt=(row,u)=>{
 const x=Math.max(0,Math.min(1,u))*255,i=Math.floor(x),f=x-i,a=pointAt(row,i/255),b=pointAt(row,Math.min(255,i+1)/255);
 return a.map((v,k)=>v*(1-f)+b[k]*f);
};
function measure(sampleAt,full=true){
 const counts={rows:widths.size,people:people.total,wardSamples:0,obstacle:0,water:0,unsupported:0,maxSupportError:0,overTwoCentimetres:0,overFiveCentimetres:0},examples={};
 for(const [row,{half,length,closed}]of widths)for(let sample=0,steps=Math.max(1,Math.ceil(length*.5));sample<steps*2+1;sample++){
  const u=sample/2/steps,[x,y,z,slope]=sampleAt(row,u);
  const ward=world.metro.wards.find(w=>Math.abs(x-w.def.x)<w.half&&Math.abs(z-w.def.z)<w.half);
  if(!ward)continue;
  const du=1.5/length,wrap=v=>closed?((v%1)+1)%1:v,a=sampleAt(row,wrap(u-du)),b=sampleAt(row,wrap(u+du));
  const dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)||1,across=Math.max(2,Math.ceil(half*2/.8));
  for(let lane=0;lane<=across;lane++){
   const lateral=-half+2*half*lane/across,dEnd=closed?1e4:Math.min(u,1-u)*length;
   const fade=THREE.MathUtils.smoothstep(dEnd,0,Math.max(1.5,Math.min(10,Math.abs(lateral)*1.5))),lat=lateral*fade;
   const X=x+dz/l*lat,Z=z-dx/l*lat,Y=y+slope*lat,lx=X-ward.def.x,lz=Z-ward.def.z;
   assert.ok([X,Y,Z].every(Number.isFinite),'GPU texture sample remains finite across row boundaries');
   counts.wardSamples++;
   const footChecks=full?[[0,0],[.7,.7],[-.7,.7],[.7,-.7],[-.7,-.7]]:[[0,0]];
   const supportError=Math.max(...footChecks.map(([fx,fz])=>Math.abs(Y-ground(X+fx,Z+fz)-.002)));
   if(supportError>counts.maxSupportError){counts.maxSupportError=supportError;examples.maxSupport={row,u,X,Y,Z,ground:ground(X,Z),ward:ward.def.id,lateral};}
   if(supportError>.02)counts.overTwoCentimetres++;if(supportError>.05)counts.overFiveCentimetres++;
   const issues={unsupported:supportError>.005};
   if(full){const probe=civic.get(ward);issues.obstacle=probe(X,Y,Z,2.1,.7);issues.water=footChecks.some(([fx,fz])=>world.metro.plan.surfaceAt(X+fx,Z+fz)==='water');}
   for(const [key,bad]of Object.entries(issues))if(bad){counts[key]++;if(!examples[key])examples[key]={row,u,X,Y,Z,ground:ground(X,Z),ward:ward.def.id,lateral};}
  }
 }
 return {counts,examples};
}
const actual=measure(pointAt),coarse=measure(coarseAt,false);
console.log(JSON.stringify({body,...actual,coarseControl:coarse,textureBytes:tex.data.byteLength,peopleBuildMs,medium:{qualityRows,qualityMissing,oldPrefixMissing,qualityDrawn}},null,2));
assert.ok(coarse.counts.unsupported>0,'positive control: fixed256-sample quay loops cut waterfront corners');
const aurora=world.metro.wards.find(w=>w.def.id==='aurora');
assert.ok(aurora.plan.obstacles.some(o=>o.prim.d(10280.618688421308-aurora.def.x,-7174.06520442361-aurora.def.z)<.32),'positive control: the original observatory walking band enters the actual civic plot');
assert.equal(civic.get(aurora)(10280.618688421308,19.03,-7174.06520442361),false,'the old reservation example is open forecourt, not proof of physical collision');
const observatory=aurora.plan.landmarks.find(l=>l.type==='observatory'),ox=aurora.def.x+observatory.x,oz=aurora.def.z+observatory.z;
assert.ok(civic.get(aurora)(ox,ground(ox,oz)+.03,oz),'actual observatory drum interior is occupied');
const southmarch=world.metro.wards.find(w=>w.def.id==='southmarch');
assert.ok(civic.get(southmarch)(333.2666666507721,3.0299999713897705,14144.6435546875),'actual narrow-structure collision found between the earlier radial clearance probes');
const forecourt=[10250.33124106363,19.03,-7099.8794248126405];
assert.ok(aurora.plan.obstacles.some(o=>o.prim.d(forecourt[0]-aurora.def.x,forecourt[2]-aurora.def.z)<.32),'forecourt lies within conservative civic reservation');
assert.equal(civic.get(aurora)(...forecourt),false,'actual open forecourt remains a usable public space');
assert.ok(people.total>11000&&people.total<12000,'preserve the established population density');
assert.ok(tex.data.byteLength<32e6,'spatially sampled path texture remains bounded');
if(!auditOnly){for(const key of ['obstacle','water','unsupported'])assert.equal(actual.counts[key],0,`all actual walking envelopes avoid ${key}`);console.log('PEOPLE_VERIFIED');}
