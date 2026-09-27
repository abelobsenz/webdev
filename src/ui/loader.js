// Loading screen: percentage and the stage list under the progress bar.
// (The bar and status line themselves are driven by main.js.)
let stages = null;

export function loaderProgress(p) {
  const pct = document.getElementById('loader-pct');
  if (pct) pct.textContent = `${Math.round(Math.min(Math.max(p, 0), 1) * 100)}%`;
  if (!stages) stages = [...document.querySelectorAll('#loader-stages li')].map((el) => ({ el, at: parseFloat(el.dataset.at) || 0 }));
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const next = stages[i + 1] ? stages[i + 1].at : 1.0001;
    s.el.classList.toggle('done', p >= next);
    s.el.classList.toggle('now', p >= s.at && p < next);
  }
}

/** Resolve after the browser has had a chance to paint (two animation frames). */
export function nextPaint() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(() => requestAnimationFrame(finish)); } catch (e) { finish(); }
    setTimeout(finish, 120);   // hidden tabs do not run rAF
  });
}
