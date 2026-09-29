/**
 * Everything is synthesised at runtime, so there are no licensing questions for v0.
 * Final release should swap in recorded SFX and composed stems (see roadmap M9).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambience!: GainNode;
  private musicTimer = 0;
  private step = 0;
  private nextNoteTime = 0;
  intensity = 0;
  volume = 0.8;
  musicVolume = 0.55;
  private noiseBuf: AudioBuffer | null = null;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.35;
    this.ambience.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    // Factory room tone: brown noise + mains hum.
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    n.connect(lp).connect(this.ambience);
    n.start();
    const hum = ctx.createOscillator();
    hum.frequency.value = 100;
    const hg = ctx.createGain();
    hg.gain.value = 0.025;
    hum.connect(hg).connect(this.ambience);
    hum.start();
    this.nextNoteTime = ctx.currentTime + 0.1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setMusic(v: number) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.value = v * 0.5;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bus: GainNode, when = 0, slide = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, bus?: GainNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus ?? this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  play(name: string) {
    if (!this.ctx) return;
    const b = this.sfxBus;
    switch (name) {
      case 'click': this.tone(1800, 0.03, 'square', 0.05, b); break;
      case 'ui': this.tone(900, 0.05, 'triangle', 0.08, b); break;
      case 'feeder': this.noise(0.08, 0.3, 2500, 4); this.tone(300, 0.06, 'square', 0.05, b, 0.05); break;
      case 'print': this.noise(0.9, 0.08, 800, 0.7); break;
      case 'wipe': this.noise(0.5, 0.2, 3000, 0.8); break;
      case 'conveyor': this.noise(0.4, 0.05, 200, 1); break;
      case 'mail': this.tone(1320, 0.12, 'sine', 0.12, b); this.tone(1760, 0.18, 'sine', 0.1, b, 0.12); break;
      case 'good': [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.12, b, i * 0.08)); break;
      case 'ship': this.tone(1567, 0.08, 'square', 0.05, b); this.tone(2093, 0.15, 'square', 0.05, b, 0.07); break;
      case 'bad': this.tone(220, 0.35, 'sawtooth', 0.12, b, 0, -80); break;
      case 'fail': this.tone(160, 0.25, 'square', 0.1, b); this.tone(120, 0.3, 'square', 0.1, b, 0.2); break;
      case 'alarm': for (let i = 0; i < 3; i++) this.tone(880, 0.12, 'square', 0.08, b, i * 0.22); break;
      case 'bin': this.noise(0.5, 0.4, 400, 0.6); break;
      case 'ping': this.tone(4200, 0.08, 'sine', 0.12, b, 0, 2000); this.noise(0.05, 0.2, 6000, 3, 0.02); break;
      case 'changeover': this.noise(1.2, 0.08, 1200, 0.5); break;
      case 'step': this.noise(0.06, 0.08, 180, 1); break;
      case 'squeegee': this.noise(0.2, 0.12, 1400, 2); break;
      case 'sizzle': this.noise(0.4, 0.14, 5000, 1.5); break;
      case 'scrape': this.noise(0.12, 0.18, 2200, 3); break;
      case 'fire': this.noise(3, 0.6, 300, 0.3); this.tone(660, 2.5, 'sawtooth', 0.08, b, 0.2, 0); break;
      case 'phone': for (let i = 0; i < 4; i++) { this.tone(440, 0.1, 'sine', 0.1, b, i * 0.25); this.tone(480, 0.1, 'sine', 0.1, b, i * 0.25); } break;
      case 'lightsout': this.tone(120, 1.4, 'sawtooth', 0.15, b, 0, -90); break;
    }
  }

  /** Adaptive music: layers and tempo follow stress. Call every frame. */
  update(dt: number) {
    if (!this.ctx) return;
    this.musicTimer += dt;
    const bpm = 92 + this.intensity * 60;
    const stepDur = 60 / bpm / 4;
    const ctx = this.ctx;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime - ctx.currentTime);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private scheduleStep(step: number, when: number) {
    const i = this.intensity;
    const bus = this.musicBus;
    const bar = Math.floor(step / 16);
    const roots = [110, 98, 87.3, 98];
    const root = roots[bar] * (i > 0.75 ? 1.059 : 1);
    const s = step % 16;
    // Bass
    if (s % 4 === 0 || (i > 0.4 && s % 4 === 3)) this.tone(root, 0.18, 'triangle', 0.09, bus, when);
    // Kick-ish thump
    if (s % 8 === 0 || (i > 0.55 && s % 8 === 6)) this.tone(90, 0.12, 'sine', 0.16, bus, when, -50);
    // Hats
    if (i > 0.2 && s % 2 === 0) this.noise(0.03, 0.03 + i * 0.03, 8000, 2, when, bus);
    // Snare
    if (i > 0.35 && s % 8 === 4) this.noise(0.12, 0.08, 1800, 0.8, when, bus);
    // Arp — gets more frantic
    if (i > 0.5 && s % 2 === 1) {
      const arp = [1, 1.5, 2, 1.26, 2, 1.5][Math.floor(step / 2) % 6];
      this.tone(root * 4 * arp, 0.07, 'square', 0.02 + (i - 0.5) * 0.03, bus, when);
    }
    // Pad at the top of each bar
    if (s === 0) {
      this.tone(root * 2, 1.6, 'sine', 0.035, bus, when);
      this.tone(root * 3, 1.6, 'sine', 0.02, bus, when);
    }
    // Alarm stab in the red zone
    if (i > 0.85 && s === 8) this.tone(root * 8, 0.1, 'sawtooth', 0.03, bus, when);
  }
}
