// Sustained real-frame review on a fixed quality/resolution and immutable build.
// PLAYWRIGHT_MODULE=... node tools/runtime-review.mjs views.json output-dir build.html [seconds=20] [quality=max]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [viewsFile, output, buildFile, secondsArg = '20', quality = 'max'] = process.argv.slice(2);
if (!viewsFile || !output || !buildFile) throw new Error('Expected views, output directory, immutable HTML build');
const seconds = Number(secondsArg);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) throw new Error('Expected 5–120 seconds per view');
if (!['low','medium','high','max'].includes(quality)) throw new Error('Unknown quality preset');
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
const dist = path.resolve(buildFile);
const report = { startedAt: new Date().toISOString(), dist, buildSha256: createHash('sha256').update(fs.readFileSync(dist)).digest('hex'), quality, width: 1280, height: 720, secondsPerView: seconds, views: [], logs: [] };
fs.mkdirSync(output, { recursive: true });
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300000);
page.on('pageerror', error => report.logs.push({ type: 'pageerror', text: error.message }));
page.on('console', message => { if (message.type() === 'error') report.logs.push({ type: 'console-error', text: message.text().slice(0, 3000) }); });
try {
  await page.goto(`${pathToFileURL(dist)}?capture&quality=${quality}`);
  await page.waitForFunction(() => window.meridian?.step || document.querySelector('#loader.error'));
  report.renderer = await page.evaluate(() => {
    const gl = window.meridian.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  for (const view of views) {
    const row = await page.evaluate(async ({ view: v, seconds }) => {
      const a = window.meridian;
      a.hours = v.t ?? 14; a.timeSpeed = 0; a.elapsed = 0;
      a.perf.enabled = false; // Fixed-resolution comparison, no adaptive downscaling.
      if (v.space) {
        if (a.space.mode === 'off') a.space.enter(true);
        a.space.sim.paused = true;
        const t = a.space.targets[v.space];
        if (!t) throw new Error(`Unknown target ${v.space}`);
        a.space.rig.set(t, v.az ?? t.view.az, v.el ?? t.view.el, v.dist ?? t.defaultDist);
        for (let i = 0; i < 80 && !a.space.bake.ready; i++) a.space.bake.step(18);
      } else {
        if (a.space.mode !== 'off') a.space.exit(true);
        a.controls.enabled = true; a.controls.flight = null; a.controls.orbit = null;
        a.controls.baseFov = a.controls.fov = v.fov ?? 60;
        a.controls.setPose(new a.THREE.Vector3(v.x, v.y, v.z), 0, 0);
        a.controls.lookAt(new a.THREE.Vector3(...v.look));
      }
      if (v.eval) (0, eval)(v.eval);
      a.step(12, 1/60);
      a.perf.gpuSamples.length = 0;
      const cpu = [], intervals = [], tris = [], calls = [];
      const started = performance.now(); let last = started;
      await new Promise(resolve => {
        const frame = now => {
          const delta = now - last; last = now;
          const t = performance.now(); a.frame(Math.min(.1, Math.max(0, delta / 1000))); cpu.push(performance.now() - t);
          intervals.push(delta); tris.push(a.renderer.info.render.triangles); calls.push(a.renderer.info.render.calls);
          if (now - started >= seconds * 1000) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      a.renderer.getContext().finish();
      const summarize = values => {
        const s = values.slice().sort((x,y) => x-y);
        return { count:s.length, min:s[0]??null, mean:s.length?s.reduce((a,b)=>a+b,0)/s.length:null, median:s[Math.floor(s.length*.5)]??null, p95:s[Math.min(s.length-1,Math.floor(s.length*.95))]??null, max:s.at(-1)??null };
      };
      let invalidTransforms = 0;
      (v.space ? a.space.scene : a.scene).traverse(o => { if (!o.matrixWorld.elements.every(Number.isFinite)) invalidTransforms++; });
      return { durationSeconds:(performance.now()-started)/1000, frames:cpu.length, cpuMs:summarize(cpu), frameIntervalMs:summarize(intervals.slice(1)), gpuMs:summarize(a.perf.gpuSamples), triangles:summarize(tris), calls:summarize(calls), invalidTransforms,
        resources:{...a.renderer.info.memory, programs:a.renderer.info.programs.length}, pixelRatio:a.renderer.getPixelRatio(), renderScale:a.dynScale, contextLost:a.renderer.getContext().isContextLost() };
    }, { view, seconds });
    report.views.push({ ...view, ...row }); save();
    console.log(JSON.stringify({ name:view.name, seconds:row.durationSeconds, frames:row.frames, frameMs:row.frameIntervalMs.median, gpuMs:row.gpuMs.median, triangles:row.triangles.mean }));
  }
  report.transitions = await page.evaluate(() => {
    const a = window.meridian, states = [];
    const post = () => Object.fromEntries(['uAO','uShaftDark','uShaftLit','uStreak','uDirt'].map(k => [k,a.pipeline.finalMat.uniforms[k].value]));
    const city = () => {
      if (a.space.mode !== 'off') a.space.exit(true);
      a.hours=14;a.timeSpeed=0;a.elapsed=0;a.controls.baseFov=a.controls.fov=60;
      a.controls.setPose(new a.THREE.Vector3(3000,1650,4700),0,0);a.controls.lookAt(new a.THREE.Vector3(0,800,0));a.step(6,1/60);
    };
    city(); const initial = post();
    for (let i=0;i<12;i++) {
      a.space.enter(true);a.space.sim.paused=true;const t=a.space.targets.halo;a.space.rig.set(t,t.view.az,t.view.el,t.defaultDist);a.step(6,1/60);
      const orbital=post();city();
      states.push({ cycle:i+1, orbital, city:post(), mode:a.space.mode, controlsEnabled:a.controls.enabled, aoValid:a.pipeline.aoValid, resources:{...a.renderer.info.memory,programs:a.renderer.info.programs.length} });
    }
    return { initial, states };
  });
  report.completedAt = new Date().toISOString(); save();
  console.log('RUNTIME_REVIEW_CAPTURED');
} finally { save(); await browser.close(); }
