// Riktiga inspelningar: RPM-styrda motorloopar med växellåda, krockar,
// skrap, däcktjut, vind. Filerna listas i audio/manifest.json:
//   { "filer": { "v8_idle": ["v8_idle.ogg"], "crash_heavy": ["crash_heavy_1.ogg", …] },
//     "rpm":   { "v8_idle": 850, "v8_high": 4500, … } }
// Saknas en slot faller motsvarande ljud tillbaka på syntes (audio.js).

const ENGINE_SLOTS = {
  v8: ['v8_idle', 'v8_high'],
  i4: ['i4_idle', 'i4_high'],
  old: ['old_idle', 'i4_high'],
  standard: ['i4_idle', 'i4_high'],
  el: ['ev_whine'],
};
// Växlarnas toppfart (km/h) — varvtalet klättrar genom växeln och faller vid uppväxling
const GEAR_TOP = [55, 95, 140, 190, 250, 420];
const REDLINE = 7200;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class SampleSfx {
  constructor(ctx, master) {
    this.ctx = ctx;
    this.master = master;
    this.buf = new Map();     // slot → [AudioBuffer]
    this.loopBuf = new Map(); // slot → loopad AudioBuffer (korsbledad)
    this.rpmOf = {};
    this.ready = false;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(master);
    this._lastT = ctx.currentTime;
  }

  async load() {
    let man;
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      man = await r.json();
    } catch { return; }
    this.rpmOf = man.rpm || {};
    const jobs = [];
    for (const [slot, files] of Object.entries(man.filer || {})) {
      for (const f of files) {
        jobs.push(fetch('audio/' + f).then(r => r.arrayBuffer())
          .then(ab => this.ctx.decodeAudioData(ab))
          .then(b => { if (!this.buf.has(slot)) this.buf.set(slot, []); this.buf.get(slot).push(b); })
          .catch(e => console.warn('Ljud kunde inte laddas:', f, e)));
      }
    }
    await Promise.all(jobs);
    this.ready = this.buf.size > 0;
    // Starta de ständiga looparna (tysta tills de behövs)
    this.tire = this._loopLayer('tire_screech');
    this.wind = this._loopLayer('wind');
    this.roll = this._loopLayer('tire_roll');
    this.scrape = this._loopLayer('metal_scrape');
  }

  has(slot) { return this.buf.has(slot); }

  // Korsbleder svansen in i början → sömlös loop även från oklippta inspelningar
  _loop(slot) {
    if (this.loopBuf.has(slot)) return this.loopBuf.get(slot);
    const src = this.buf.get(slot)?.[0];
    if (!src) return null;
    const sr = src.sampleRate, n = src.length;
    const x = Math.min(Math.floor(0.08 * sr), Math.floor(n / 4));
    const out = this.ctx.createBuffer(1, n - x, sr);
    const a = src.getChannelData(0), d = out.getChannelData(0);
    for (let i = 0; i < n - x; i++) d[i] = a[i];
    for (let i = 0; i < x; i++) {
      const t = i / x;
      d[i] = a[i] * Math.sqrt(t) + a[n - x + i] * Math.sqrt(1 - t);
    }
    this.loopBuf.set(slot, out);
    return out;
  }

  _loopLayer(slot, dest = this.bus) {
    const b = this._loop(slot);
    if (!b) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    s.connect(g).connect(dest);
    s.start(this.ctx.currentTime + Math.random() * 0.05);
    return { src: s, gain: g };
  }

  _one(slot, vol = 1, rate = 1) {
    const list = this.buf.get(slot);
    if (!list || !list.length) return false;
    const b = list[Math.floor(Math.random() * list.length)];
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g).connect(this.bus);
    s.start();
    return true;
  }

  // ---------- Motor ----------
  _engine(type) {
    const slots = (ENGINE_SLOTS[type] || ENGINE_SLOTS.standard).filter(s => this.has(s));
    if (!slots.length) return null;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const out = this.ctx.createGain();
    out.gain.value = 0;
    lp.connect(out).connect(this.bus);
    const layers = slots.map(s => ({ slot: s, ...this._loopLayer(s, lp), base: this.rpmOf[s] || (/idle/.test(s) ? 900 : 4500) }));
    for (const L of layers) L.gain.gain.value = 1;
    return { type, lp, out, layers, rpm: 900, gear: 0, shiftT: 0 };
  }

  _stopEngine(E) {
    if (!E) return;
    const t = this.ctx.currentTime;
    E.out.gain.setTargetAtTime(0, t, 0.05);
    for (const L of E.layers) { try { L.src.stop(t + 0.3); } catch { /* ok */ } }
  }

  // Anropas varje bildruta med spelarens bil
  drive(st, muted) {
    if (!this.ready) return false;
    const now = this.ctx.currentTime;
    const dt = clamp(now - this._lastT, 0.001, 0.1);
    this._lastT = now;
    const type = ENGINE_SLOTS[st.motor] ? st.motor : 'standard';
    if (!this.eng || this.eng.type !== type) {
      this._stopEngine(this.eng);
      this.eng = this._engine(type);
      if (this.eng && this.has('engine_start') && type !== 'el') this._one('engine_start', 0.55);
    }
    const E = this.eng;
    const kmh = Math.abs(st.kmh);
    const th = clamp(st.throttle, 0, 1);
    const pitch = st.pitch || 1;
    const vol = muted ? 0 : 1;

    if (E && type === 'el') {
      const L = E.layers[0];
      const rate = (0.55 + (kmh / 260) * 1.75) * pitch;
      L.src.playbackRate.setTargetAtTime(rate, now, 0.05);
      E.lp.frequency.setTargetAtTime(1500 + th * 9000, now, 0.08);
      E.out.gain.setTargetAtTime(vol * (0.05 + Math.min(1, kmh / 180) * 0.3 + th * 0.08), now, 0.08);
    } else if (E) {
      // Växellåda
      const idle = 900;
      let target;
      if (kmh < 6) target = idle + th * 2600;
      else {
        target = Math.max(idle, REDLINE * kmh / GEAR_TOP[E.gear]);
        if (target > REDLINE * 0.96 && E.gear < GEAR_TOP.length - 1) { E.gear++; E.shiftT = 0.14; }
        else if (E.gear > 0 && REDLINE * kmh / GEAR_TOP[E.gear - 1] < REDLINE * 0.62) { E.gear--; E.shiftT = 0.1; }
        target = Math.max(idle, REDLINE * kmh / GEAR_TOP[E.gear]);
        if (th < 0.05) target *= 0.92;
      }
      if (kmh < 3 && th < 0.05) E.gear = 0;
      E.rpm += (target - E.rpm) * Math.min(1, dt * (E.shiftT > 0 ? 18 : 9));
      E.shiftT = Math.max(0, E.shiftT - dt);
      const blend = E.layers.length > 1 ? smooth(1700, 4200, E.rpm) : 0;
      E.layers.forEach((L, i) => {
        const r = clamp(E.rpm / L.base, i === 0 ? 0.65 : 0.45, i === 0 ? 2.8 : 2.0) * pitch;
        L.src.playbackRate.setTargetAtTime(r, now, 0.03);
        const g = E.layers.length > 1 ? (i === 0 ? 1 - blend : blend) : 1;
        L.gain.gain.setTargetAtTime(g, now, 0.04);
      });
      const dip = E.shiftT > 0 ? 0.45 : 1;
      E.lp.frequency.setTargetAtTime(700 + th * 6500 + blend * 2500, now, 0.06);
      E.out.gain.setTargetAtTime(vol * dip * (0.3 + th * 0.35 + blend * 0.15), now, 0.04);
    }

    // Däck, vind, rullning, skrap
    const slip = st.slip || 0;
    if (this.tire) {
      const g = st.grounded === false ? 0 : clamp((slip - 3) / 9, 0, 1) * 0.45;
      this.tire.gain.gain.setTargetAtTime(vol * g, now, 0.06);
      this.tire.src.playbackRate.setTargetAtTime(0.9 + clamp(slip / 60, 0, 0.3), now, 0.1);
    }
    if (this.wind) this.wind.gain.gain.setTargetAtTime(vol * Math.min(1, (kmh / 260) ** 2) * 0.3, now, 0.2);
    if (this.roll) this.roll.gain.gain.setTargetAtTime(vol * (st.grounded === false ? 0 : Math.min(1, kmh / 160) * 0.14), now, 0.1);
    if (this.scrape) this.scrape.gain.gain.setTargetAtTime(vol * (st.scrape ? clamp(0.25 + kmh / 300, 0, 0.6) : 0), now, 0.05);
    return true;
  }

  stopAll() {
    const t = this.ctx.currentTime;
    if (this.eng) this.eng.out.gain.setTargetAtTime(0, t, 0.05);
    for (const L of [this.tire, this.wind, this.roll, this.scrape]) if (L) L.gain.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---------- Engångsljud ----------
  crash(intensity) {
    if (!this.ready) return false;
    const heavy = intensity > 0.45;
    const slot = heavy && this.has('crash_heavy') ? 'crash_heavy' : (this.has('crash_light') ? 'crash_light' : 'crash_heavy');
    const ok = this._one(slot, clamp(0.35 + intensity * 0.9, 0, 1.2), 0.86 + Math.random() * 0.26);
    if (heavy && Math.random() < 0.3) this._one('glass_shatter', 0.5 * intensity, 0.9 + Math.random() * 0.2);
    return ok;
  }

  partOff(glas) {
    if (!this.ready) return false;
    if (glas && this._one('glass_shatter', 0.45, 0.9 + Math.random() * 0.25)) return true;
    return this._one('metal_debris', 0.5, 0.85 + Math.random() * 0.3);
  }

  boom(v = 1) { return this.ready && this._one('explosion', 0.9 * v, 0.9 + Math.random() * 0.15); }
  boost() { return this.ready && this._one('boost', 0.7); }
  launch(pitch = 1) {
    if (!this.ready) return false;
    const a = this._one('rev', 0.55, pitch);
    this._one('tire_screech', 0.25, 1.05);
    return a;
  }
  raceStart() {
    if (!this.ready) return false;
    const a = this._one('horn_start', 0.7);
    this._one('crowd', 0.5);
    return a;
  }
  cheer() { return this.ready && this._one('crowd', 0.6); }
}
