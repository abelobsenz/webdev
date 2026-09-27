const $ = (id) => document.getElementById(id);

/**
 * On-screen controls for touch devices: a virtual joystick (bottom left) to fly, rise and
 * descend buttons (bottom right), and the rest of the screen to look (handled by FlyControls).
 * Shown automatically on coarse pointers or after the first touch, or forced in Settings.
 */
export class TouchUI {
  constructor(ui) {
    this.ui = ui;
    this.c = ui.app.controls;
    this.enabled = false;
    this.sawTouch = false;
    this.stickId = null;
    this.vec = { x: 0, y: 0 };
    this.lift = 0;
    this._bind();
    window.addEventListener('touchstart', () => { if (!this.sawTouch) { this.sawTouch = true; this.refresh(); } }, { passive: true, once: true });
  }

  refresh() {
    const mode = this.ui.prefs.touchUI;
    let coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* ignore */ }
    const on = !this.ui.capture && (mode === 'on' || (mode === 'auto' && (coarse || this.sawTouch)));
    this.enabled = on;
    $('touch').hidden = !on;
    document.body.classList.toggle('touch-ui', on);
    if (!on) this._reset();
  }

  _bind() {
    const stick = $('stick'), knob = $('stick-knob');
    const R = 44;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > R) { dx *= R / m; dy *= R / m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // gentle response near the centre, full speed at the rim
      const k = (v) => Math.sign(v) * Math.pow(Math.abs(v) / R, 1.35);
      this.vec.x = k(dx); this.vec.y = -k(dy);
      this._push();
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      stick.classList.add('active');
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      stick.classList.remove('active');
      knob.style.transform = '';
      this.vec.x = this.vec.y = 0;
      this._push();
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    for (const [id, dir] of [['t-up', 1], ['t-down', -1]]) {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* optional */ } this.lift = dir; b.classList.add('on'); this._push(); });
      const off = () => { if (this.lift === dir) this.lift = 0; b.classList.remove('on'); this._push(); };
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _push() { this.c.setVirtual(this.vec.x, this.vec.y, this.lift); }

  _reset() { this.vec.x = this.vec.y = 0; this.lift = 0; this.c.setVirtual(0, 0, 0); }
}
