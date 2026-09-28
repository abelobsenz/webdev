import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.ok(report.completedAt,'runtime sweep completed');
assert.equal(createHash('sha256').update(fs.readFileSync(report.dist)).digest('hex'),report.buildSha256,'immutable source build matches report');
const expected=JSON.parse(fs.readFileSync(process.argv[3]||'review/refinement/budget-views.json','utf8'));
assert.deepEqual(report.views.map(v=>v.name),expected.map(v=>v.name),'every declared representative camera is covered in order');
assert.equal(new Set(report.views.map(v=>v.name)).size,report.views.length,'no repeated pose substitutes for a missing destination');
assert.deepEqual(report.logs,[],'no runtime/console errors');
for(const v of report.views){
  assert.ok(v.durationSeconds>=report.secondsPerView&&v.frames>30,`${v.name}: sustained rendering`);
  assert.equal(v.invalidTransforms,0,`${v.name}: finite scene transforms`);
  assert.equal(v.contextLost,false,`${v.name}: GPU context retained`);
  assert.equal(v.renderScale,1,`${v.name}: full preset resolution`);
  assert.ok(v.triangles.min>0&&v.triangles.max<60e6,`${v.name}: bounded rendered workload`);
}
const ground=report.views.filter(v=>!v.space),meanGround=ground.reduce((s,v)=>s+v.triangles.mean,0)/ground.length;
assert.ok(meanGround<50e6,'ground-only average stays within the requested approximately50M budget');
const states=report.transitions.states;assert.equal(states.length,12);
for(const s of states){
  for(const value of Object.values(s.orbital))assert.equal(value,0,'orbital composition does not sample stale city buffers');
  assert.equal(s.mode,'off');assert.equal(s.controlsEnabled,true);assert.equal(s.aoValid,true);
  assert.ok(s.city.uAO>0,'city AO restored after orbit');
}
const settled=states.slice(2);
for(const k of ['geometries','textures','programs'])assert.equal(new Set(settled.map(s=>s.resources[k])).size,1,`stable ${k} after warmup across repeated transitions`);
console.log(JSON.stringify({meanGroundTriangles:meanGround,maxViewTriangles:Math.max(...report.views.map(v=>v.triangles.max)),renderedFrames:report.views.reduce((s,v)=>s+v.frames,0),transitions:states.length,renderer:report.renderer}));
console.log('WORLD_RUNTIME_VERIFIED');
