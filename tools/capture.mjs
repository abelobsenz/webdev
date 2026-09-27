// Headless capture harness (Chromium + SwiftShader software WebGL).
// Renders deterministic frames of the built app for visual review.
//
//   npm run build
//   node tools/capture.mjs <views.json> <outPrefix> [width height] [--dist path/to/dist/index.html]
//
// views.json: [{ "name": "...", "t": 17.5, "x": 0, "y": 200, "z": 5000, "yaw": 0, "pitch": 0,
//               "look": [0, 900, 0], "fov": 60, "frames": 2, "eval": "optional JS run before stepping" }]
// Writes <outPrefix><index>.jpg and prints per-view stats (draw calls, triangles).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const distIdx = args.indexOf('--dist');
let dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
if (distIdx >= 0) { dist = path.resolve(args[distIdx + 1]); args.splice(distIdx, 2); }
const [viewsFile, prefix = 'shot', W = '960', H = '540'] = args;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 1500)}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const t0 = Date.now();
await page.goto(`file://${dist}?capture`);
try {
  await page.waitForFunction(() => document.body.classList.contains('ready') || document.getElementById('loader')?.classList.contains('error'), null, { timeout: 300000, polling: 500 });
} catch { logs.push('timeout waiting for ready'); }
console.log('load', (Date.now() - t0) / 1000, 's');
for (let k = 0; k < views.length; k++) {
  const v = views[k];
  const res = await page.evaluate(async (v) => {
    const a = window.meridian; if (!a || !a.step) return { err: 'app not ready' };
    const THREE = a.THREE;
    a.hours = v.t ?? a.hours;
    if (v.fov) { a.controls.baseFov = a.controls.fov = v.fov; }
    a.controls.setPose(new THREE.Vector3(v.x, v.y, v.z), (v.yaw || 0) * Math.PI / 180, (v.pitch || 0) * Math.PI / 180);
    if (v.look) a.controls.lookAt(new THREE.Vector3(...v.look));
    if (v.eval) { try { (0, eval)(v.eval); } catch (e) { return { err: String(e) }; } }
    const frames = v.frames || 2;
    a.step(frames);
    const i = a.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, url: a.canvas.toDataURL('image/jpeg', 0.9) };
  }, v);
  if (res.url) fs.writeFileSync(`${prefix}${k}.jpg`, Buffer.from(res.url.split(',')[1], 'base64'));
  delete res.url;
  console.log(k, v.name || '', JSON.stringify(res));
}
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
