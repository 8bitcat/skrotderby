import { SampleSfx } from './sfx.js?v=18';
// Procedurellt ljud via WebAudio — motor, krascher, explosioner, signaler
// + loopande synthwave-musik (ingen musikfil, allt genereras).
export class AudioFx {
  constructor() {
    this.ok = false;
    this.muted = false;
    this.musicOn = true;
    this.musicStarted = false;
  }

  init() {
    if (this.ok) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // Motor: mjukt brum — såg + sinus-sub genom hårt lågpass (inget skrik)
      this.engGain = this.ctx.createGain();
      this.engGain.gain.value = 0;
      this.engLp = this.ctx.createBiquadFilter();
      this.engLp.type = 'lowpass';
      this.engLp.frequency.value = 300;
      this.engLp.Q.value = 0.6;
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.value = 50;
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'sine';
      this.osc2.frequency.value = 25;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.7;
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

      // Bakgrundsflik: rAF pausar men oscillatorerna spelar vidare — tysta dem,
      // annars "hänger sig" motorbrum/musik när man byter flik
      document.addEventListener('visibilitychange', () => {
        if (!this.ok) return;
        if (document.hidden) {
          this.sfx?.stopAll();
          this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
          this.musicGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        } else {
          this._applyMusicGain();
        }
      });

      // Riktiga inspelningar laddas i bakgrunden; syntes används tills de finns
      this.sfx = new SampleSfx(this.ctx, this.master);
      this.sfx.load().catch(() => {});

      this.ok = true;
    } catch { /* ljud är inte livsviktigt */ }
  }

  // Spelarens bil varje bildruta: {kmh, throttle, motor, pitch, slip, scrape, grounded}
  drive(st) {
    if (!this.ok) return;
    if (document.hidden) return;
    if (this.sfx?.drive(st, this.muted)) {
      this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }
    const synt = st.motor === 'v8b' ? 'v8' : (st.motor === 'el' || st.motor === 'v8' ? st.motor : 'standard');
    this.setEngine(Math.min(1, (st.kmh / 3.6) / 50), st.throttle, synt);
  }

  partOff(glas) {
    if (!this.ok || this.muted) return;
    this.sfx?.partOff(glas);
  }

  // Motorkaraktär per bil: V8 (djup + tomgångs-lope), elmotor (vin), standard.
  // Förbränningsmotorer hörs alltid på tomgång.
  setEngine(norm, throttle, typ = 'standard') {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const th = Math.abs(throttle);
    if (this._motorTyp !== typ) {
      this._motorTyp = typ;
      this.osc1.type = typ === 'el' ? 'triangle' : 'sawtooth';
      this.osc2.type = 'sine';
    }
    if (typ === 'el') {
      // Elvin: ren stigande ton, tyst på tomgång
      const f = 90 + norm * 820 + th * 40;
      this.osc1.frequency.setTargetAtTime(f, t, 0.05);
      this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05); // svävning en oktav upp
      this.engLp.frequency.setTargetAtTime(500 + norm * 3200, t, 0.1);
      const g = this.muted ? 0 : 0.008 + norm * 0.055 + th * 0.02;
      this.engGain.gain.setTargetAtTime(g, t, 0.08);
      return;
    }
    const v8 = typ === 'v8';
    // Tomgångs-lope på V8:n: långsam wobbel som försvinner med varvtalet
    const lope = v8 ? Math.sin(t * 6.5) * 3.5 * Math.max(0, 1 - norm * 4) : 0;
    const base = v8 ? 30 : 44;
    const f = base + norm * (v8 ? 66 : 90) + th * 10 + lope;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engLp.frequency.setTargetAtTime((v8 ? 140 : 190) + norm * (v8 ? 460 : 620), t, 0.12);
    const idle = v8 ? 0.055 : 0.04; // tomgångsljud
    const g = this.muted ? 0 : idle + norm * 0.05 + th * 0.04;
    this.engGain.gain.setTargetAtTime(g, t, 0.08);
  }

  // Startljud när man drar iväg från stillastående
  launch(typ = 'standard', pitch = 1) {
    if (this.ok && !this.muted && this.sfx?.launch(typ, pitch)) return;
    if (!this.ok || this.muted) return;
    const t = this.ctx.currentTime;
    if (typ === 'el') {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(950, t + 0.55);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.65);
    } else {
      // Rev-blip + däcktjut
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const v8 = typ === 'v8';
      o.frequency.setValueAtTime(v8 ? 55 : 75, t);
      o.frequency.exponentialRampToValueAtTime(v8 ? 190 : 240, t + 0.28);
      o.frequency.exponentialRampToValueAtTime(v8 ? 120 : 160, t + 0.5);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = v8 ? 500 : 700;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.6);
    }
    // Däckchirp
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 950;
    bp.Q.value = 3;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp).connect(ng).connect(this.master);
    src.start(t + 0.02, Math.random() * 0.4, 0.25);
  }

  // ---------- Musik: WipEout-doftande techno-loop (140 BPM, acid-bas) ----------
  startMusic() {
    if (!this.ok || this.musicStarted) return;
    this.musicStarted = true;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = (this.muted || !this.musicOn) ? 0 : 0.16;
    this.musicGain.connect(this.master);
    // Eko för stabbar
    this.echo = this.ctx.createDelay(0.6);
    this.echo.delayTime.value = 0.214; // punkterad åttondel vid 140 BPM
    this.echoFb = this.ctx.createGain();
    this.echoFb.gain.value = 0.32;
    this.echo.connect(this.echoFb).connect(this.echo);
    this.echo.connect(this.musicGain);
    this._beat = 0;
    this._nextT = this.ctx.currentTime + 0.1;
    this._musTimer = setInterval(() => this._schedule(), 30);
  }

  _schedule() {
    const STEP = 60 / 140 / 4; // sextondelar i 140 BPM
    while (this._nextT < this.ctx.currentTime + 0.18) {
      this._playStep(this._beat, this._nextT);
      this._beat++;
      this._nextT += STEP;
    }
  }

  _playStep(i, t) {
    const bar = Math.floor(i / 16) % 4;
    const pos = i % 16;
    const bar8 = Math.floor(i / 16) % 8;
    const roots = [55, 55, 65.41, 49]; // A A C G — mörkt & drivande
    const root = roots[bar];

    // Pumpande fyra-på-golvet
    if (pos % 4 === 0) this._kick(t);
    // Clap på 2 & 4
    if (pos === 4 || pos === 12) this._snare(t);
    // Stängd hatt på 16-delar, öppen på offbeat
    if (pos % 4 === 2) this._hat(t, 0.5, 0.11);
    else if (pos % 2 === 1) this._hat(t, 0.22, 0.035);
    // ACID-BAS: 16-delssekvens med accenter + filtersvep över 4 takter
    const seq = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 3, 10, 7, 12, 0];
    const semi = seq[pos];
    const accent = pos % 4 === 2 || pos === 12;
    const sweep = ((i % 256) / 256); // långsamt svep över 16 takter
    this._acid(t, root * Math.pow(2, semi / 12), accent, sweep);
    // Mörk moll-stab i början av varje takt (varannan 8-takters vända)
    if (pos === 0 && bar8 >= 4) this._stab(t, root * 2);
    // Riser-brus in mot varje ny 8-takters vända
    if (pos === 0 && bar === 3 && bar8 % 4 === 3) this._riser(t);
  }

  _acid(t, f, accent, sweep) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 11;
    const base = 220 + sweep * 700;
    lp.frequency.setValueAtTime(base + (accent ? 1500 : 350), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, base * 0.6), t + 0.09);
    const g = this.ctx.createGain();
    this._env(g, t, accent ? 0.3 : 0.2, 0.1);
    o.connect(lp).connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + 0.12);
  }

  _stab(t, f) {
    for (const semi of [0, 3, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * Math.pow(2, semi / 12);
      const g = this.ctx.createGain();
      this._env(g, t, 0.05, 0.16);
      o.connect(g);
      g.connect(this.musicGain);
      g.connect(this.echo);
      o.start(t); o.stop(t + 0.18);
    }
  }

  _riser(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    const dur = (60 / 140) * 4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + dur);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    src.connect(bp).connect(g).connect(this.musicGain);
    src.start(t, Math.random() * 0.3, dur + 0.1);
  }

  _env(node, t, peak, dur) {
    node.gain.setValueAtTime(peak, t);
    node.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    const g = this.ctx.createGain();
    this._env(g, t, 0.95, 0.2);
    o.connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + 0.22);
  }

  _snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    this._env(g, t, 0.32, 0.13);
    src.connect(bp).connect(g).connect(this.musicGain);
    src.start(t, Math.random() * 0.5, 0.16);
  }

  _hat(t, v) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const g = this.ctx.createGain();
    this._env(g, t, v * 0.22, 0.04);
    src.connect(hp).connect(g).connect(this.musicGain);
    src.start(t, Math.random() * 0.5, 0.05);
  }

  _bass(t, f) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.ctx.createGain();
    this._env(g, t, 0.3, 0.12);
    o.connect(lp).connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + 0.14);
  }

  _arp(t, f) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = this.ctx.createGain();
    this._env(g, t, 0.11, 0.1);
    o.connect(g);
    g.connect(this.musicGain);
    g.connect(this.echo);
    o.start(t); o.stop(t + 0.12);
  }

  _applyMusicGain() {
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(
        (this.muted || !this.musicOn) ? 0 : 0.15,
        this.ctx.currentTime, 0.05
      );
    }
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    this._applyMusicGain();
    return this.musicOn;
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

  crash(intensity, pan = 0) {
    if (!this.ok || this.muted) return;
    if (this.sfx?.crash(intensity, pan)) return;
    this._burst(intensity * 0.7, 400 + Math.random() * 900, 0.22 + intensity * 0.15);
  }

  boom(intensity = 1) {
    if (this.ok && !this.muted && this.sfx?.boom(intensity)) return;
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
    if (this.ok && !this.muted && this.sfx?.raceStart()) return;
    this._tone(440, 0, 0.15);
    this._tone(440, 0.5, 0.15);
    this._tone(880, 1.0, 0.4);
  }

  boost() {
    if (this.ok && !this.muted && this.sfx?.boost()) return;
    if (!this.ok || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(560, t + 0.24);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
    this._burst(0.25, 2600, 0.2);
  }

  win() {
    if (this.ok && !this.muted) this.sfx?.cheer();
    this._tone(523, 0, 0.14);
    this._tone(659, 0.15, 0.14);
    this._tone(784, 0.3, 0.14);
    this._tone(1047, 0.45, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyMusicGain();
    return this.muted;
  }
}
