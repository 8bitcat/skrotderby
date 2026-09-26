// Procedurellt ljud via WebAudio — motor, krascher, explosioner, signaler.
export class AudioFx {
  constructor() {
    this.ok = false;
    this.muted = false;
  }

  init() {
    if (this.ok) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // Motor: två oscillatorer genom lågpass
      this.engGain = this.ctx.createGain();
      this.engGain.gain.value = 0;
      this.engLp = this.ctx.createBiquadFilter();
      this.engLp.type = 'lowpass';
      this.engLp.frequency.value = 600;
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.value = 70;
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'square';
      this.osc2.frequency.value = 35;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.4;
      this.osc1.connect(this.engLp);
      this.osc2.connect(g2).connect(this.engLp);
      this.engLp.connect(this.engGain).connect(this.master);
      this.osc1.start();
      this.osc2.start();

      // Brusbuffert för krascher
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.ok = true;
    } catch { /* ljud är inte livsviktigt */ }
  }

  setEngine(norm, throttle) {
    if (!this.ok) return;
    const f = 60 + norm * 170 + Math.abs(throttle) * 30;
    this.osc1.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.osc2.frequency.setTargetAtTime(f / 2, this.ctx.currentTime, 0.05);
    this.engLp.frequency.setTargetAtTime(300 + norm * 2400, this.ctx.currentTime, 0.1);
    const g = this.muted ? 0 : 0.045 + norm * 0.075 + Math.abs(throttle) * 0.045;
    this.engGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
  }

  _burst(vol, freq, dur) {
    if (!this.ok || this.muted || vol <= 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, vol), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  crash(intensity) {
    this._burst(intensity * 0.7, 400 + Math.random() * 900, 0.22 + intensity * 0.15);
  }

  boom(intensity = 1) {
    this._burst(intensity, 180, 0.7);
    if (!this.ok || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    g.gain.setValueAtTime(intensity * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
  }

  _tone(freq, t0, dur, vol = 0.25, type = 'square') {
    if (!this.ok || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime + t0;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  raceStart() {
    this._tone(440, 0, 0.15);
    this._tone(440, 0.5, 0.15);
    this._tone(880, 1.0, 0.4);
  }

  win() {
    this._tone(523, 0, 0.14);
    this._tone(659, 0.15, 0.14);
    this._tone(784, 0.3, 0.14);
    this._tone(1047, 0.45, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
