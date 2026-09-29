// Compile-checks every shader of the Earth-and-sky domain with naga (a real GLSL front end and IR
// validator: types, overloads, undeclared names, returns, out-parameters), headless. naga reads
// Vulkan GLSL 450, so each three.js ShaderMaterial is translated the way three would assemble it:
// loose uniforms into one block, combined samplers split into texture + sampler (sampler-typed
// function parameters too), varyings and attributes given locations, the QUALITY/STEPS defines
// of every tier. GLSL ES differences naga cannot see (implicit int-to-float conversions) are
// linted separately below.
//
//   NAGA=/path/to/naga node tools/validate-earth-glsl.mjs      (cargo install naga-cli)
// Without naga it reports SKIPPED and exits 0, so it never blocks a machine without the tool.
import * as THREE from 'three';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

globalThis.Image = globalThis.Image || class { set src(v) { this._src = v; } };
const naga = process.env.NAGA || process.argv[2];
if (!naga || !fs.existsSync(naga)) { console.log('VALIDATE_EARTH_GLSL_SKIPPED (set NAGA to a naga binary)'); process.exit(0); }

const { SpaceSim } = await import('../src/space/sim.js');
const { Earth } = await import('../src/space/earth.js');
const { EarthBake } = await import('../src/space/earthBake.js');
const { createSpaceSky } = await import('../src/space/sky.js');
const { Aurora } = await import('../src/space/aurora.js');
const { Meteors } = await import('../src/space/meteors.js');
const F = await import('../src/space/earthFine.js');

const ATTRS = { position: 'vec3', normal: 'vec3', uv: 'vec2', color: 'vec3' };
const BUILTIN = 'mat4 modelMatrix; mat4 modelViewMatrix; mat4 projectionMatrix; mat4 viewMatrix; mat3 normalMatrix; vec3 cameraPosition; bool isOrthographic;';

function toVulkan(src, defines, stage) {
  let s = src.replace(/^\s*precision[^;]*;/gm, '');
  const unis = [];
  let bind = 1;
  s = s.replace(/^\s*uniform\s+(\w+)\s+(\w+)(\s*\[[^\]]*\])?\s*;/gm, (m, t, n, a) => {
    if (/^(modelMatrix|modelViewMatrix|projectionMatrix|viewMatrix|normalMatrix|cameraPosition|isOrthographic)$/.test(n)) return '';
    if (/sampler/.test(t)) {
      const tt = t.replace('sampler', 'texture');
      return `layout(set = 0, binding = ${bind++}) uniform ${tt} ${n}_t; layout(set = 0, binding = ${bind++}) uniform sampler ${n}_s;\n#define ${n} ${t}(${n}_t, ${n}_s)`;
    }
    unis.push(`${t} ${n}${a || ''};`);
    return '';
  });
  // sampler-typed parameters (the atmosphere's LUT helpers) and the calls that pass a global
  s = s.replace(/\(sampler2D lut,/g, '(texture2D lut_t, sampler lut_s,').replace(/\b(texture|textureLod)\(lut,/g, '$1(sampler2D(lut_t, lut_s),');
  s = s.replace(/\b(sampleTransmittance|sampleMultiScat|skyRadiance|spaceSunlight)\((\w+),/g, '$1($2_t, $2_s,');
  let loc = 0;
  s = s.replace(/^\s*varying\s+(\w+)\s+(\w+)\s*;/gm, (m, t, n) => `layout(location = ${loc++}) ${stage === 'frag' ? 'in' : 'out'} ${t} ${n};`);
  let aloc = 0;
  s = s.replace(/^\s*attribute\s+(\w+)\s+(\w+)\s*;/gm, (m, t, n) => `layout(location = ${aloc++}) in ${t} ${n};`);
  const head = ['#version 450', ...Object.entries(defines || {}).map(([k, x]) => `#define ${k} ${x}`)];
  s = s.replace(/\btexture2D\s*\(/g, 'texture(').replace(/\btextureCube\s*\(/g, 'texture(');
  if (stage === 'frag') head.push('layout(location = 0) out vec4 pc_fragColor;', '#define gl_FragColor pc_fragColor');
  else {
    // three's built-in attributes, where the shader reads them without declaring them
    for (const [n, t] of Object.entries(ATTRS)) if (new RegExp(`\\b${n}\\b`).test(s) && !new RegExp(`in\\s+\\w+\\s+${n}\\s*;`).test(s)) head.push(`layout(location = ${8 + aloc++}) in ${t} ${n};`);
    head.push('#define gl_VertexID gl_VertexIndex', '#define gl_InstanceID gl_InstanceIndex');
  }
  // (uniform values as module-scope globals: the same types and names, no block layout rules)
  head.push(BUILTIN.split(';').filter((x) => x.trim()).map((x) => x.trim() + ';').join(' '), unis.join(' '));
  return head.join('\n') + '\n' + s;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'earth-glsl-'));
let fails = 0, checked = 0;
function check(name, mat) {
  for (const [stage, src] of [['vert', mat.vertexShader], ['frag', mat.fragmentShader]]) {
    const file = path.join(dir, `${name}.${stage}`);
    fs.writeFileSync(file, toVulkan(src, mat.defines, stage));
    let out;
    try { out = execFileSync(naga, ['--input-kind', 'glsl', '--shader-stage', stage, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    out = out.replace(/\x1b\[[0-9;]*m/g, '');
    checked++;
    if (!/Validation successful/.test(out)) { fails++; console.log(`FAIL ${name}/${stage}\n${out.split('\n').slice(0, 14).join('\n')}`); }
  }
}

const tex = () => ({ texture: new THREE.Texture() });
const fakeBake = { surfA: tex(), surfB: tex(), clouds: { ...tex(), width: 1024 }, lights: tex(), ids: tex(), ready: true };
for (let q = 0; q <= 3; q++) check(`earth-q${q}`, new Earth(fakeBake, { earthQ: q, atmoSteps: 5 + 2 * q }).material);
check('earth-bake', new EarthBake(null, 64, 64).mat);
const sky = createSpaceSky();
check('sky', sky.material);
check('stars', sky.userData.stars.material);
const sim = new SpaceSim();
const space = { scene: new THREE.Scene(), sim, camera: new THREE.PerspectiveCamera(50, 1.6, 1, 1e7), bodies: [], addBody(name, o, c, r, opts) { const b = { name, objects: o, center: c, radius: r, ...opts }; this.bodies.push(b); return b; } };
const aurora = new Aurora(space, { earthQ: 3 });
check('aurora-arcs', aurora.arcMat);
check('aurora-oval', aurora.ovalMat);
check('meteors', new Meteors(space, { rate: 40 }).material);

// GLSL ES 3.00 has no implicit int-to-float conversion: an integer literal where a float is
// wanted compiles under 450 but not in the browser. The fine module is generated from tables,
// so check its every numeric literal is a float (or an index, bound or define).
const fine = (F.EARTH_FINE_GLSL + F.EARTH_FINE_SHADOW_GLSL + F.EARTH_FINE_RELIEF_GLSL).replace(/\/\/.*$/gm, '');
for (const line of fine.split('\n')) {
  if (/^\s*#/.test(line)) continue;
  const bare = line.replace(/\bfor\s*\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\b(?:i|k|oct|QUALITY)\s*(?:==|<=|>=|<|>)\s*\d+/g, '').replace(/\d+\.\d*|\d*\.\d+|\d+e-?\d+/g, 'F');
  const m = bare.match(/(^|[^\w])(\d+)(?![\w.])/);
  if (m) { fails++; console.log(`FAIL fine: integer literal ${m[2]} in: ${line.trim()}`); }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ shadersChecked: checked }));
if (fails) { console.log(`VALIDATE_EARTH_GLSL_FAILED (${fails})`); process.exit(1); }
console.log('VALIDATE_EARTH_GLSL_OK');
