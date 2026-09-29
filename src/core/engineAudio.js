// Engine voices for the piloted craft, synthesised on the ambient audio's context (so the sound
// toggle and volume apply). Nothing is downloaded.
//   'fans'   the aerodyne's ducted fans: a blade-pass whine that rises with rpm over broadband
//            duct roar, a low body hum, and a brighter edge on boost
//   'drive'  the starcourier's plasma drive: a deep throb, a soft hiss, a faint high harmonic,
//            and short thruster breaths while it manoeuvres
export class EngineVoice {
  constructor(audio, kind) {
    this.audio = audio;
    this.kind = kind;
    this.nodes = null;
    this.level = 0;
  }

  _init() {
    const a = this.audio, ctx = a && a.ctx;
    if (!ctx || !a.master) return false;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(a.master);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    { const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.015 * w; d[i] = this.kind === 'drive' ? b * 6 : w; } }
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.7; nf.frequency.value = this.kind === 'drive' ? 220 : 900;
    const ng = ctx.createGain(); ng.gain.value = 0;
    noise.connect(nf); nf.connect(ng); ng.connect(out);
    const tone = ctx.createOscillator(); tone.type = this.kind === 'drive' ? 'sine' : 'sawtooth'; tone.frequency.value = this.kind === 'drive' ? 48 : 180;
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = this.kind === 'drive' ? 160 : 1400; tf.Q.value = 3;
    const tg = ctx.createGain(); tg.gain.value = 0;
    tone.connect(tf); tf.connect(tg); tg.connect(out);
    const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = this.kind === 'drive' ? 96 : 62;
    const hg = ctx.createGain(); hg.gain.value = 0;
    hum.connect(hg); hg.connect(out);
    // thruster breaths (drive) / tip whistle (fans): a second, brighter noise band
    const bf = ctx.createBiquadFilter(); bf.type = 'highpass'; bf.frequency.value = this.kind === 'drive' ? 1800 : 3000;
    const bg = ctx.createGain(); bg.gain.value = 0;
    noise.connect(bf); bf.connect(bg); bg.connect(out);
    noise.start(); tone.start(); hum.start();
    this.nodes = { out, nf, ng, tone, tf, tg, hum, hg, bf, bg };
    return true;
  }

  /**
   * on: whether the craft is being flown; rpm 0..1; thrust 0..1; boost 0/1; extra 0..1
   * (thrusters for the drive, a hard turn for the fans).
   */
  set(on, rpm, thrust, boost = 0, extra = 0) {
    const a = this.audio;
    if (!a || !a.ctx) return;
    if (!a.enabled) { if (this.nodes) this.nodes.out.gain.setTargetAtTime(0, a.ctx.currentTime, 0.2); return; }
    if (!this.nodes && !this._init()) return;
    const n = this.nodes, t = a.ctx.currentTime, k = 0.12;
    const vol = on ? 1 : 0;
    n.out.gain.setTargetAtTime(vol * 0.55, t, 0.35);
    if (this.kind === 'fans') {
      n.tone.frequency.setTargetAtTime(150 + rpm * 330 + boost * 60, t, k);
      n.tf.frequency.setTargetAtTime(900 + rpm * 2200, t, k);
      n.tg.gain.setTargetAtTime(0.018 + 0.05 * rpm, t, k);
      n.nf.frequency.setTargetAtTime(500 + thrust * 1300, t, k);
      n.ng.gain.setTargetAtTime(0.05 + 0.2 * thrust + 0.1 * boost, t, k);
      n.hum.frequency.setTargetAtTime(55 + rpm * 30, t, k);
      n.hg.gain.setTargetAtTime(0.05 + 0.05 * rpm, t, k);
      n.bg.gain.setTargetAtTime(0.02 * rpm + 0.06 * extra + 0.05 * boost, t, k);
    } else {
      n.tone.frequency.setTargetAtTime(42 + thrust * 26 + boost * 10, t, k);
      n.tg.gain.setTargetAtTime(0.06 + 0.22 * thrust + 0.1 * boost, t, k);
      n.nf.frequency.setTargetAtTime(160 + thrust * 520, t, k);
      n.ng.gain.setTargetAtTime(0.02 + 0.12 * thrust + 0.08 * boost, t, k);
      n.hum.frequency.setTargetAtTime(92 + thrust * 40, t, k);
      n.hg.gain.setTargetAtTime(0.012 + 0.02 * rpm, t, k);
      n.bg.gain.setTargetAtTime(0.09 * extra, t, 0.05);
    }
  }
}
