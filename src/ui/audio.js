// Generative soundscape (Web Audio). Everything is synthesised; nothing is downloaded.
//
//  music     a slowly evolving chord pad with occasional glass-bell notes from the current chord
//  lagoon    brown-noise swells that wash in and out, with foam hiss, louder near the shore
//  wind      band-passed noise with gusts that grows with altitude, plus air rush with speed
//  city      a low, distant hum of the districts (quieter at night and far from town)
//  birds     synthesised chirps and phrases around dawn over land
//  insects   night crickets over land
//  ui        subtle interface sounds (tick, open/close, fly, shutter, chapter)
//
// Layers are mixed from the camera's surroundings every frame with smooth crossfades.
const CHORDS = [
  [62, 66, 69, 73, 76],   // Dmaj9
  [59, 62, 66, 69, 74],   // Bm11
  [55, 59, 62, 66, 71],   // Gmaj7
  [57, 61, 64, 69, 71],   // Aadd9
  [54, 57, 61, 64, 69],   // F#m7
  [52, 55, 59, 62, 66],   // Em9
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
    this.music = 0.7;
    this.chord = 0;
    this.chordTimer = 0;
    this.bellTimer = 3;
    this.birdTimer = 0;
    this.cricketAhead = 0;
    this.gustTimer = 0;
    this.washTimers = [1.5, 4.2];
    this.env = { waves: 0, wind: 0, rush: 0, city: 0, birds: 0, insects: 0 };
  }

  // ------------------------------------------------------------ set-up --
  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    let ctx;
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master.connect(comp); comp.connect(ctx.destination);

    // reverb (generated impulse response, gently filtered tail)
    const conv = ctx.createConvolver();
    const len = Math.floor(sr * 4.2);
    const ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - t, 2.4) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    conv.buffer = ir;
    this.reverb = ctx.createGain(); this.reverb.gain.value = 1;
    this.reverb.connect(conv);
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    conv.connect(wet); wet.connect(this.master);

    // buses
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.music;
    const musicDry = ctx.createGain(); musicDry.gain.value = 0.42;
    this.musicBus.connect(musicDry); musicDry.connect(this.master);
    const musicWet = ctx.createGain(); musicWet.gain.value = 0.7;
    this.musicBus.connect(musicWet); musicWet.connect(this.reverb);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1;
    this.ambBus.connect(this.master);
    const ambWet = ctx.createGain(); ambWet.gain.value = 0.12;
    this.ambBus.connect(ambWet); ambWet.connect(this.reverb);
    this.uiBus = ctx.createGain(); this.uiBus.gain.value = 0.5;
    this.uiBus.connect(this.master);
    const uiWet = ctx.createGain(); uiWet.gain.value = 0.3;
    this.uiBus.connect(uiWet); uiWet.connect(this.reverb);

    // noise sources
    const white = ctx.createBuffer(2, sr * 4, sr);
    const brown = ctx.createBuffer(2, sr * 4, sr);
    for (let c = 0; c < 2; c++) {
      const w = white.getChannelData(c), b = brown.getChannelData(c);
      let last = 0;
      for (let i = 0; i < w.length; i++) {
        const r = Math.random() * 2 - 1;
        w[i] = r * 0.5;
        last = (last + 0.02 * r) / 1.02;
        b[i] = last * 3.2;
      }
    }
    this.whiteBuf = white; this.brownBuf = brown;
    const src = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 3); return s; };

    this._buildPad();

    // lagoon: two swell chains (left / right) with foam, through one layer gain
    this.wavesG = ctx.createGain(); this.wavesG.gain.value = 0;
    this.wavesG.connect(this.ambBus);
    this.waves = [];
    for (let k = 0; k < 2; k++) {
      const s = src(this.brownBuf, 0.9 + k * 0.13);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.3;
      const swell = ctx.createGain(); swell.gain.value = 0.25;
      const foamSrc = src(this.whiteBuf, 1);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
      const foam = ctx.createGain(); foam.gain.value = 0;
      const out = ctx.createGain(); out.gain.value = 1;
      s.connect(lp); lp.connect(swell); swell.connect(out);
      foamSrc.connect(hp); hp.connect(foam); foam.connect(out);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = k ? 0.55 : -0.55; out.connect(pan); pan.connect(this.wavesG); } else out.connect(this.wavesG);
      this.waves.push({ swell, foam, lp });
    }

    // wind (gusts) and air rush (speed)
    {
      const s = src(this.whiteBuf, 0.6);
      this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 520; this.windF.Q.value = 0.9;
      this.windGust = ctx.createGain(); this.windGust.gain.value = 0.5;
      this.windG = ctx.createGain(); this.windG.gain.value = 0;
      this.windPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      s.connect(this.windF); this.windF.connect(this.windGust); this.windGust.connect(this.windG);
      if (this.windPan) { this.windG.connect(this.windPan); this.windPan.connect(this.ambBus); } else this.windG.connect(this.ambBus);
      const r = src(this.whiteBuf, 1.3);
      this.rushF = ctx.createBiquadFilter(); this.rushF.type = 'bandpass'; this.rushF.frequency.value = 1400; this.rushF.Q.value = 0.5;
      this.rushG = ctx.createGain(); this.rushG.gain.value = 0;
      r.connect(this.rushF); this.rushF.connect(this.rushG); this.rushG.connect(this.ambBus);
    }

    // city hum: detuned low tones + filtered rumble
    {
      this.cityG = ctx.createGain(); this.cityG.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 210; lp.Q.value = 0.5;
      for (const [f, g] of [[55, 0.35], [55.35, 0.3], [82.6, 0.12], [110.2, 0.08]]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = g;
        o.connect(og); og.connect(lp); o.start();
      }
      const rum = src(this.brownBuf, 0.5);
      const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 320;
      const rg = ctx.createGain(); rg.gain.value = 0.9;
      rum.connect(rlp); rlp.connect(rg); rg.connect(lp);
      lp.connect(this.cityG); this.cityG.connect(this.ambBus);
    }

    // birds and insects are scheduled on demand into these gains
    this.birdG = ctx.createGain(); this.birdG.gain.value = 0; this.birdG.connect(this.ambBus);
    const birdWet = ctx.createGain(); birdWet.gain.value = 0.5; this.birdG.connect(birdWet); birdWet.connect(this.reverb);
    this.insectG = ctx.createGain(); this.insectG.gain.value = 0; this.insectG.connect(this.ambBus);
    this.crickets = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4300 + i * 260 + Math.random() * 120;
      const am = ctx.createGain(); am.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(am);
      if (pan) { pan.pan.value = (i - 1) * 0.7; am.connect(pan); pan.connect(this.insectG); } else am.connect(this.insectG);
      o.start();
      this.crickets.push({ am, next: ctx.currentTime + 0.5 + i * 0.37, rate: 0.55 + Math.random() * 0.35 });
    }
    this._setChord(0, 0.1);
    return true;
  }

  _buildPad() {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.4;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.1;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.musicBus);
    this.voices = [];
    for (let i = 0; i < 5; i++) {
      const g = ctx.createGain(); g.gain.value = 0;
      const o1 = ctx.createOscillator(); o1.type = 'sine';
      const o2 = ctx.createOscillator(); o2.type = 'triangle';
      o2.detune.value = 6 + i * 1.3;
      const og = ctx.createGain(); og.gain.value = 0.32;
      o1.connect(g); o2.connect(og); og.connect(g);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = (i - 2) * 0.3; g.connect(pan); pan.connect(this.padFilter); } else g.connect(this.padFilter);
      o1.start(); o2.start();
      this.voices.push({ o1, o2, g });
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.027;
    const lfoG = ctx.createGain(); lfoG.gain.value = 360;
    lfo.connect(lfoG); lfoG.connect(this.padFilter.frequency); lfo.start();
  }

  _setChord(idx, fade = 6) {
    const t = this.ctx.currentTime;
    const notes = CHORDS[idx % CHORDS.length];
    this.voices.forEach((v, i) => {
      const f = mtof(notes[i] - 12 * (i === 0 ? 1 : 0));
      v.o1.frequency.setTargetAtTime(f, t, fade * 0.35);
      v.o2.frequency.setTargetAtTime(f * 2, t, fade * 0.35);
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.17 / (1 + i * 0.25), t, fade * 0.3);
    });
  }

  // ----------------------------------------------------------- control --
  async setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx) { if (!this._init()) return; }
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
    this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, on ? 1.2 : 0.4);
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.15);
  }

  setMusic(v) {
    this.music = clamp01(v);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.music, this.ctx.currentTime, 0.3);
  }

  // --------------------------------------------------------- ui sounds --
  ui(kind) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const tone = (f, dur, gain, type = 'sine', at = t, f2 = null) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur * 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(this.uiBus); o.start(at); o.stop(at + dur + 0.05);
    };
    const noise = (dur, gain, f0, f1, q = 1.2, at = t) => {
      const s = ctx.createBufferSource(); s.buffer = this.whiteBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(bp); bp.connect(g); g.connect(this.uiBus); s.start(at, Math.random() * 2); s.stop(at + dur + 0.05);
    };
    switch (kind) {
      case 'tick': tone(1480, 0.07, 0.05); break;
      case 'open': tone(880, 0.5, 0.05); tone(1318.5, 0.7, 0.035, 'sine', t + 0.06); break;
      case 'close': tone(1318.5, 0.35, 0.035); tone(880, 0.5, 0.04, 'sine', t + 0.05); break;
      case 'fly': noise(1.6, 0.09, 300, 1800, 0.9); break;
      case 'shutter': noise(0.05, 0.4, 3000, 2000, 0.8); noise(0.08, 0.25, 1600, 900, 1.5, t + 0.07); tone(90, 0.12, 0.12, 'sine', t); break;
      case 'chapter': tone(mtof(50), 3.5, 0.06, 'sine'); tone(mtof(57), 3.5, 0.04, 'sine', t + 0.2); tone(mtof(62), 4, 0.03, 'sine', t + 0.4); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ update --
  /**
   * @param {object} z  { altitude (above surface), height, speed, night, hours, land (0..1 land around),
   *                      urban (0..1), dawn (0..1) }
   */
  update(dt, z = {}) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const alt = z.altitude ?? 0, H = z.height ?? alt, spd = z.speed ?? 0, night = z.night ?? 0, hours = z.hours ?? 12;
    const land = z.land ?? 0, urban = z.urban ?? 0;
    const low = 1 - smooth(20, 420, alt);

    // --- music
    this.chordTimer += dt;
    if (this.chordTimer > 15) { this.chordTimer = 0; this.chord = (this.chord + 1 + (Math.random() < 0.25 ? 1 : 0)) % CHORDS.length; this._setChord(this.chord); }
    this.padFilter.frequency.setTargetAtTime(650 + (1 - night) * 900 + smooth(500, 8000, H) * 500, t, 2.5);
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      this.bellTimer = 5 + Math.random() * 9;
      const notes = CHORDS[this.chord];
      const n = notes[Math.floor(Math.random() * notes.length)] + 12 * (Math.random() < 0.5 ? 1 : 2);
      this._bell(mtof(n), t + 0.02, 0.018 + 0.012 * night);
    }

    // --- lagoon swells
    const shore = 1 - Math.abs(land - 0.45) * 1.6;
    const waves = low * (0.45 + 0.55 * clamp01(shore)) * (1 - smooth(0.85, 1, land)) * 0.26;
    this._mix('waves', this.wavesG.gain, waves, t, 1.2);
    for (let k = 0; k < this.waves.length; k++) {
      this.washTimers[k] -= dt;
      if (this.washTimers[k] <= 0) {
        const w = this.waves[k];
        const period = 5.5 + Math.random() * 4.5;
        this.washTimers[k] = period;
        const peak = 0.55 + Math.random() * 0.45;
        w.swell.gain.cancelScheduledValues(t);
        w.swell.gain.setTargetAtTime(peak, t, period * 0.16);
        w.swell.gain.setTargetAtTime(0.16, t + period * 0.42, period * 0.22);
        w.foam.gain.cancelScheduledValues(t);
        w.foam.gain.setTargetAtTime(0.05 * peak, t + period * 0.25, period * 0.1);
        w.foam.gain.setTargetAtTime(0.0, t + period * 0.5, period * 0.2);
        w.lp.frequency.setTargetAtTime(380 + peak * 420, t, period * 0.2);
      }
    }

    // --- wind with gusts; air rush with speed
    const wind = (0.03 + smooth(60, 2600, alt) * 0.2 + smooth(3000, 25000, H) * 0.06);
    this._mix('wind', this.windG.gain, wind, t, 1.5);
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 2.5 + Math.random() * 4;
      const g = 0.35 + Math.random() * 0.75;
      this.windGust.gain.setTargetAtTime(g, t, 1.1);
      this.windF.frequency.setTargetAtTime(320 + Math.random() * 380 + smooth(100, 5000, alt) * 380, t, 1.4);
      if (this.windPan) this.windPan.pan.setTargetAtTime((Math.random() - 0.5) * 0.8, t, 2);
    }
    const rush = smooth(25, 700, spd) * 0.13;
    this._mix('rush', this.rushG.gain, rush, t, 0.4);
    this.rushF.frequency.setTargetAtTime(900 + Math.min(spd, 1500) * 1.6, t, 0.5);

    // --- distant city
    const city = urban * (1 - smooth(300, 3500, alt)) * (0.5 + 0.5 * (1 - night * 0.6)) * 0.22 + smooth(200, 2500, alt) * 0.02 * (1 - smooth(6000, 20000, H));
    this._mix('city', this.cityG.gain, city, t, 2);

    // --- birds around dawn (fewer through the day), over land and low
    const dawn = smooth(5.2, 6.1, hours) * (1 - smooth(8.4, 9.6, hours));
    const day = smooth(7, 9, hours) * (1 - smooth(16.5, 18.2, hours)) * 0.3;
    const birds = (dawn + day) * land * (1 - smooth(60, 500, alt));
    this._mix('birds', this.birdG.gain, birds > 0.02 ? 0.5 : 0, t, 1.5);
    if (birds > 0.02) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = (0.5 + Math.random() * 2.4) / Math.max(birds, 0.15);
        this._birdPhrase(t + 0.05);
      }
    }

    // --- crickets at night
    const insects = smooth(0.55, 0.9, night) * land * (1 - smooth(40, 320, alt));
    this._mix('insects', this.insectG.gain, insects * 0.035, t, 2);
    if (insects > 0.02) this._scheduleCrickets(t);
  }

  _mix(key, param, value, t, tc) {
    if (Math.abs(this.env[key] - value) < 1e-4) return;
    this.env[key] = value;
    param.setTargetAtTime(value, t, tc);
  }

  _bell(f, at, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 5);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = (Math.random() - 0.5) * 1.2; g.connect(pan); pan.connect(this.musicBus); } else g.connect(this.musicBus);
    for (const [m, a] of [[1, 1], [2.76, 0.28], [5.4, 0.08]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og); og.connect(g); o.start(at); o.stop(at + 5.1);
    }
  }

  _birdPhrase(at) {
    const ctx = this.ctx;
    const species = Math.floor(Math.random() * 3);
    const base = [2600, 3400, 4300][species] * (0.9 + Math.random() * 0.2);
    const n = 2 + Math.floor(Math.random() * (species === 1 ? 6 : 4));
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = 0.35 + Math.random() * 0.4;
    if (pan) { pan.pan.value = (Math.random() - 0.5) * 1.6; out.connect(pan); pan.connect(this.birdG); } else out.connect(this.birdG);
    let tt = at;
    for (let i = 0; i < n; i++) {
      const dur = species === 0 ? 0.16 + Math.random() * 0.12 : 0.05 + Math.random() * 0.07;
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = base * (0.85 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, tt);
      if (species === 0) { o.frequency.exponentialRampToValueAtTime(f0 * 1.45, tt + dur * 0.4); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, tt + dur); }
      else if (species === 1) o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 0.7 : 1.35), tt + dur);
      else { o.frequency.exponentialRampToValueAtTime(f0 * 1.2, tt + dur * 0.5); o.frequency.exponentialRampToValueAtTime(f0 * 1.05, tt + dur); }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.05, tt + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g); g.connect(out); o.start(tt); o.stop(tt + dur + 0.02);
      tt += dur + (species === 1 ? 0.03 + Math.random() * 0.05 : 0.08 + Math.random() * 0.16);
    }
    setTimeout(() => { try { out.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* gone */ } }, (tt - at + 0.5) * 1000);
  }

  _scheduleCrickets(t) {
    for (const c of this.crickets) {
      while (c.next < t + 0.6) {
        const start = Math.max(c.next, t);
        const pulses = 3 + Math.floor(Math.random() * 2);
        for (let p = 0; p < pulses; p++) {
          const a = start + p * 0.034;
          c.am.gain.setValueAtTime(0, a);
          c.am.gain.linearRampToValueAtTime(1, a + 0.006);
          c.am.gain.linearRampToValueAtTime(0, a + 0.022);
        }
        c.next = start + c.rate * (0.85 + Math.random() * 0.3);
      }
    }
  }
}
