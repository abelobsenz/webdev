import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loftSections, latheFacade, sweepTube } from '../src/world/geom.js';
import { Builder, KIND, buildBuildings } from '../src/world/buildings.js';
import { auditGeometry } from './geometry-audit.mjs';
const results=[];
function solid(name,geometry) {
  const r=auditGeometry(geometry); results.push({name,...r});
  assert.equal(r.nonFinite,0,`${name}: finite positions`);
  assert.equal(r.invalidNormals,0,`${name}: unit normals`);
  assert.equal(r.boundaryEdges,0,`${name}: closed boundary`);
  assert.equal(r.nonManifoldEdges,0,`${name}: manifold edges`);
  assert.equal(r.inconsistentEdges,0,`${name}: consistent winding`);
  assert.ok(r.signedVolume>0,`${name}: outward solid volume`);
}
const control=auditGeometry(new THREE.CylinderGeometry(2,2,5,12,1,true));
assert.equal(control.boundaryEdges,24,'positive control must detect both open rings');
solid('closed stock cylinder',new THREE.CylinderGeometry(2,2,5,12));
solid('loft default closed foot',loftSections([{y:0,pts:[[-2,-2],[2,-2],[2,2],[-2,2]]},{y:4,pts:[[-1,-1],[1,-1],[1,1],[-1,1]]}]));
const clockwise=[[-2,-2],[-2,2],[2,2],[2,-2]];
solid('clockwise loft is outward',loftSections([{y:0,pts:clockwise},{y:3,pts:clockwise}]));
const concave=[[-3,-3],[3,-3],[3,0],[0,0],[0,3],[-3,3]];
solid('concave loft caps',loftSections([{y:0,pts:concave},{y:3,pts:concave}]));
solid('lathe finite ends',latheFacade([{r:2,y:0},{r:2,y:4}],16));
solid('lathe cone pole',latheFacade([{r:2,y:0},{r:0,y:4}],16));
solid('lathe annular profile',latheFacade([{r:2,y:0},{r:3,y:0},{r:3,y:1},{r:2,y:1}],16,{closedProfile:true}));
const hardProfile=[{r:2,y:0,kind:1},{r:2,y:1,kind:1},{r:2,y:1,kind:6},{r:3,y:1,kind:6},{r:3,y:1,kind:2},{r:3,y:4,kind:2}];
const hardLathe=latheFacade(hardProfile,16),hardAudit=auditGeometry(hardLathe);
solid('lathe hard material and shading seams',hardLathe);
assert.equal(hardAudit.degenerates,0,'coincident facade rings do not create collapsed strips');
const hp=hardLathe.attributes.position,hf=hardLathe.attributes.aFacade;
assert.ok(Array.from({length:hp.count},(_,i)=>i).some(i=>hp.getY(i)===1&&hf.getZ(i)===1));
assert.ok(Array.from({length:hp.count},(_,i)=>i).some(i=>hp.getY(i)===1&&hf.getZ(i)===6));
const collapsed=hardLathe.clone(),oldIndex=Array.from(collapsed.index.array);oldIndex.push(17,34,18);collapsed.setIndex(oldIndex);
assert.ok(auditGeometry(collapsed).degenerates>0,'old coincident-ring face control is detected');
const repeated=latheFacade([{r:0,y:0,kind:1},{r:3,y:0,kind:1},{r:3,y:1,kind:1},{r:2.6,y:1,kind:1},{r:2.6,y:.7,kind:6},{r:2.6,y:.7,kind:6},{r:2.6,y:.7,kind:1},{r:0,y:.7,kind:1}],16);
solid('repeated fountain material-boundary ring',repeated);
assert.equal(new Set(repeated.index.array).size,repeated.attributes.position.count,'lathe retains no unused normal-less vertices');
const orphan=repeated.clone(),op=orphan.attributes.position,on=orphan.attributes.normal;
orphan.setAttribute('position',new THREE.Float32BufferAttribute([...op.array,2.6,.7,0],3));
orphan.setAttribute('normal',new THREE.Float32BufferAttribute([...on.array,0,0,0],3));
assert.ok(auditGeometry(orphan).invalidNormals>0,'original orphan shading-vertex defect is visible to the audit');
solid('swept open path endcaps',sweepTube([new THREE.Vector3(0,0,0),new THREE.Vector3(0,4,0)],()=>1,12));
solid('swept curved elliptical tube',sweepTube(Array.from({length:13},(_,i)=>new THREE.Vector3(i/2,Math.sin(i/12*Math.PI)*3,0)),t=>.3+.2*t,10,{ellipse:.5}));
const ring=Array.from({length:49},(_,i)=>new THREE.Vector3(10*Math.cos(i/48*Math.PI*2),Math.sin(i/48*Math.PI*4),10*Math.sin(i/48*Math.PI*2)));
solid('swept periodic ring seam',sweepTube(ring,()=>.6,12));
const tubeOpen=auditGeometry(sweepTube([new THREE.Vector3(),new THREE.Vector3(0,4,0)],()=>1,12,{closeEnds:false}));
assert.equal(tubeOpen.boundaryEdges,24,'explicit open effect remains open');
const built=(name,fn)=>{const b=new Builder();fn(b);solid(name,b.geometry());};
built('building default box',b=>b.box(-2,2,-3,3,0,5,KIND.STONE));
built('building parapet closed material',b=>b.parapet([[-3,-3],[3,-3],[3,3],[-3,3]],0));
built('building cornice closed material',b=>b.cornice([[-3,-3],[3,-3],[3,3],[-3,3]],0,1,.5));
built('building finite-end lathe',b=>b.lathe(0,0,[[2,0,1],[2,4,1]],16));
for (const seg of [48,64]) for (const offset of [0,16000]) built(`narrow lathe caps ${seg} segments at ${offset}m`,b=>{
  b.frame(offset,0,-offset,0.37);
  b.lathe(0,1767,[[.05,0,1],[3,1,1],[3,4,1],[.05,5,1]],seg);
});
built('building gable closed soffit',b=>b.gable(-3,3,-2,2,0,2,1,1));
built('building vault closed soffit',b=>b.vault(-3,3,-2,2,0,2,1,12));
built('arcade material shell preserves passage',b=>b.vaultZ(-3,3,-4,4,0,2,1,12,{inside:true}));
built('building closed frustum',b=>b.frustum(6,6,3,3,0,4,1));
for (const n of [2,10]) built(`closed building entrance flight ${n} risers`,b=>b.stair(-2,2,5,.3,n,-n*.165,.165,-3));
const annulus=latheFacade([{r:2,y:0},{r:3,y:0},{r:3,y:1},{r:2,y:1}],16,{closedProfile:true});
const annulusMesh=new THREE.Mesh(annulus,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
annulusMesh.updateMatrixWorld();
const ray=new THREE.Raycaster(new THREE.Vector3(0,4,0),new THREE.Vector3(0,-1,0));
assert.equal(ray.intersectObject(annulusMesh).length,0,'annular passage is not filled by caps');
ray.ray.origin.set(2.4,4,0);
assert.ok(ray.intersectObject(annulusMesh).length>=2,'annular shell has top and underside');
const passage=new Builder();passage.vaultZ(-3,3,-4,4,0,2,1,12,{inside:true});
const passageMesh=new THREE.Mesh(passage.geometry(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));passageMesh.updateMatrixWorld();
ray.ray.origin.set(0,1,-10);ray.ray.direction.set(0,0,1);
assert.equal(ray.intersectObject(passageMesh).length,0,'arcade passage remains traversable');
// Composite buildings intentionally contain touching closed parts. Their shared
// edges can have incidence >2, but no family may leave an unpaired open boundary.
const families=['ribbon','terrace','cloister','tower','pavilion','mews','stack','crystal','college','canal','arcade','solar','ziggurat','warehouse','reef','mansion','gallery','museum'];
for (const type of families) for (const seed of [3,41,127]) {
  const lot={x:0,z:0,w:60,d:50,lo:0,hi:0,rot:0,type,floors:6,seed,dk:'ward',district:'fixture',centre:.5};
  const city=buildBuildings(new THREE.Scene(),{lots:[lot],districts:[{id:'fixture',kind:'ward',x:0,z:0}]},()=>0,{lowrise:.75});
  for (const [lod,mesh] of city.meshes.entries()) {
    const r=auditGeometry(mesh.geometry,{tolerance:1e-4});
    assert.equal(r.boundaryEdges,0,`${type}/${seed}/${lod}: composite external boundary`);
    assert.equal(r.nonFinite+r.invalidNormals,0,`${type}/${seed}/${lod}: finite geometry and normals`);
    assert.equal(r.inconsistentEdges,0,`${type}/${seed}/${lod}: winding`);
  }
}
console.log(`Checked ${families.length} building families × 3 seeds × 2 LODs`);
console.log(JSON.stringify(results,null,2));
console.log('WORLD_PRIMITIVES_OK');
