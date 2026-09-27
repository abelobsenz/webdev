// Generative ambient soundscape (Web Audio): a slowly evolving chord pad,
// ocean/wind noise that follows altitude, and faint shimmer at night.
const CHORDS = [
  [62, 66, 69, 73, 76],   // Dmaj9
  [59, 62, 66, 69, 74],   // Bm11-ish
  [55, 59, 62, 66, 71],   // Gmaj7
  [57, 61, 64, 69, 71],   // Aadd9
  [54, 57, 61, 64, 69],   // F#m7
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.chord = 0;
    this.timer = 0;
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // gentle stereo reverb
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 4.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.45;
    this.bus = ctx.createGain();
    this.bus.connect(conv); conv.connect(wet); wet.connect(this.master);
    this.bus.connect(dry); dry.connect(this.master);
    this.master.connect(ctx.destination);

    // pad voices
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.4;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.11;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.bus);
    this.voices = [];
    for (let i = 0; i < 5; i++) {
      const g = ctx.createGain(); g.gain.value = 0;
      const o1 = ctx.createOscillator(); o1.type = 'sine';
      const o2 = ctx.createOscillator(); o2.type = 'triangle';
      o2.detune.value = 7 + i * 1.3;
      const og = ctx.createGain(); og.gain.value = 0.35;
      o1.connect(g); o2.connect(og); og.connect(g);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = (i - 2) * 0.3; g.connect(pan); pan.connect(this.padFilter); } else g.connect(this.padFilter);
      o1.start(); o2.start();
      this.voices.push({ o1, o2, g });
    }
    // slow filter LFO
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03;
    const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG); lfoG.connect(this.padFilter.frequency); lfo.start();

    // noise bed: ocean + wind
    const nbuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.985 * b0 + 0.015 * w; nd[i] = b0 * 6 + w * 0.05; }
    const noise = ctx.createBufferSource(); noise.buffer = nbuf; noise.loop = true;
    this.oceanF = ctx.createBiquadFilter(); this.oceanF.type = 'lowpass'; this.oceanF.frequency.value = 500;
    this.oceanG = ctx.createGain(); this.oceanG.gain.value = 0.0;
    noise.connect(this.oceanF); this.oceanF.connect(this.oceanG); this.oceanG.connect(this.master);
    const wind = ctx.createBufferSource(); wind.buffer = nbuf; wind.loop = true; wind.playbackRate.value = 1.7;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 700; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.0;
    wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    noise.start(); wind.start();
    this._setChord(0, 0.1);
    return true;
  }

  _setChord(idx, fade = 6) {
    const t = this.ctx.currentTime;
    const notes = CHORDS[idx % CHORDS.length];
    this.voices.forEach((v, i) => {
      const f = mtof(notes[i] - 12 * (i === 0 ? 1 : 0));
      v.o1.frequency.setTargetAtTime(f, t, fade * 0.35);
      v.o2.frequency.setTargetAtTime(f * 2, t, fade * 0.35);
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.18 / (1 + i * 0.25), t, fade * 0.3);
    });
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx) { if (!this._init()) return; }
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.8);
  }

  update(dt, { altitude = 0, night = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    this.timer += dt;
    if (this.timer > 14) { this.timer = 0; this.chord = (this.chord + 1) % CHORDS.length; this._setChord(this.chord); }
    const t = this.ctx.currentTime;
    const ocean = Math.max(0, 1 - altitude / 400) * 0.22;
    const wind = Math.min(1, altitude / 2500) * 0.16 + 0.02;
    this.oceanG.gain.setTargetAtTime(ocean, t, 0.5);
    this.windG.gain.setTargetAtTime(wind, t, 0.5);
    this.windF.frequency.setTargetAtTime(500 + Math.min(altitude, 30000) * 0.03, t, 1);
    this.padFilter.frequency.setTargetAtTime(700 + (1 - night) * 900, t, 2);
  }
}
