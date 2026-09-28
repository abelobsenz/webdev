// Deterministic medium-quality review with named images and machine-readable costs.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/review-capture.mjs views.json output-dir [--dist file] [--hardware]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const hardware = args.includes('--hardware');
if (hardware) args.splice(args.indexOf('--hardware'), 1);
const distAt = args.indexOf('--dist');
let dist = path.resolve('dist/index.html');
if (distAt >= 0) { dist = path.resolve(args[distAt + 1]); args.splice(distAt, 2); }
const qualityAt = args.indexOf('--quality');
let quality = 'medium';
if (qualityAt >= 0) { quality = args[qualityAt + 1]; args.splice(qualityAt, 2); }
if (!['low','medium','high','ultra','max','cinematic','reference'].includes(quality)) throw new Error('Unknown quality preset');
const [viewsPath, output] = args;
if (!viewsPath || !output) throw new Error('Expected views.json and output directory');
const views = JSON.parse(fs.readFileSync(viewsPath, 'utf8'));
fs.mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(hardware ? { channel: 'chrome', headless: true } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300000);
const logs = [];
page.on('console', m => { if (['warning', 'error'].includes(m.type())) logs.push({ type: m.type(), text: m.text().slice(0, 3000) }); });
page.on('pageerror', e => logs.push({ type: 'pageerror', text: e.message }));
const buildSha256 = createHash('sha256').update(fs.readFileSync(dist)).digest('hex');
const report = { dist, buildSha256, viewsPath: path.resolve(viewsPath), quality, width: 1280, height: 720, hardware, startedAt: new Date().toISOString(), views: [], logs };
try {
  await page.goto(`${pathToFileURL(dist)}?capture&quality=${quality}`);
  await page.waitForFunction(() => window.meridian?.step || document.querySelector('#loader.error'), null, { timeout: 300000 });
  report.renderer = await page.evaluate(() => {
    const gl = window.meridian.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  console.log(JSON.stringify({ ready: true, renderer: report.renderer }));
  for (const view of views) {
    const started = Date.now();
    const result = await page.evaluate(async v => {
      const a = window.meridian;
      if (!a?.step) throw new Error('Application did not initialize');
      // Diagnostic underside views may freeze updates and hide unrelated
      // meshes. Restore that temporary state before posing the next image.
      if (a._reviewSnapshot) {
        a.controls.update = a._reviewSnapshot.controlsUpdate;
        a.world.update = a._reviewSnapshot.worldUpdate;
        for (const [object, visible] of a._reviewSnapshot.visibility) object.visible = visible;
        delete a._reviewSnapshot;
      }
      a.hours = v.t ?? 14;
      a.elapsed = 0;
      a.timeSpeed = 0;
      if (v.space) {
        if (a.space.mode === 'off') a.space.enter(true);
        a.space.sim.paused = true;
        const target = a.space.targets[v.space];
        if (!target) throw new Error(`Unknown orbital target ${v.space}`);
        a.space.rig.set(target, v.az ?? target.view.az, v.el ?? target.view.el, v.dist ?? target.defaultDist);
        a.space._expReset = true;
        if (a.space.bake && !a.space.bake.ready) for (let i = 0; i < 80 && !a.space.bake.ready; i++) a.space.bake.step(18);
      } else {
        if (a.space.mode !== 'off') { a.space.mode = 'off'; a.space.fade = null; a.space.rig.enabled = false; a.space.hud.show(false); }
        a.controls.enabled = true;
        a.controls.flight = null;
        a.controls.orbit = null;
        a.controls.baseFov = a.controls.fov = v.fov ?? 60;
        a.controls.setPose(new a.THREE.Vector3(v.x, v.y, v.z), (v.yaw ?? 0) * Math.PI / 180, (v.pitch ?? 0) * Math.PI / 180);
        if (v.look) a.controls.lookAt(new a.THREE.Vector3(...v.look));
      }
      if (v.eval) {
        const visibility = []; a.scene.traverse(object => visibility.push([object, object.visible]));
        a._reviewSnapshot = { controlsUpdate: a.controls.update, worldUpdate: a.world.update, visibility };
        (0, eval)(v.eval);
      }
      a.step(v.frames ?? 3);
      const info = a.renderer.info;
      const scene = v.space ? a.space.scene : a.scene;
      const totals = { meshes: 0, instances: 0, triangles: 0 };
      const geometry = new Map();
      scene.traverse(o => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = o.geometry, tris = (g.index?.count ?? g.attributes.position.count) / 3;
        const count = o.isInstancedMesh ? o.count : 1;
        totals.meshes++; totals.instances += count; totals.triangles += tris * count;
        const key = o.name || o.parent?.name || g.type;
        geometry.set(key, (geometry.get(key) || 0) + tris * count);
      });
      return { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, geometries: info.memory.geometries, textures: info.memory.textures, scene: totals,
        largest: [...geometry].sort((a,b) => b[1]-a[1]).slice(0,15), image: a.canvas.toDataURL('image/jpeg', 0.94) };
    }, view);
    const file = `${view.name.replace(/[^a-z0-9_-]/gi, '-')}.jpg`;
    fs.writeFileSync(path.join(output, file), Buffer.from(result.image.split(',')[1], 'base64'));
    delete result.image;
    const row = { ...view, file, seconds: (Date.now() - started) / 1000, ...result };
    report.views.push(row);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name: view.name, seconds: row.seconds, calls: result.calls, triangles: result.triangles }));
  }
  report.completedAt = new Date().toISOString();
  report.averageTriangles = report.views.reduce((s,v) => s + v.triangles, 0) / report.views.length;
  if (logs.some(x => x.type === 'pageerror')) process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
