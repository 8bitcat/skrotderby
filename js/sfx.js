// Riktiga inspelningar (CC0, se audio/manifest.json → credits): RPM-styrda
// motorloopar med växellåda, egen motorprofil per bil, grannbilarnas motorer
// i stereo, krockar, skrap, glas, däcktjut, vind.
// Saknas en slot faller motsvarande ljud tillbaka på syntes (audio.js).

// Motorprofiler: loopar (tomgång + högvarv), varvtalstak anpassat så att
// högvarvsloopen aldrig pitchas mer än ~2× (annars låter det som en jordekorre).
const PROFILES = {
  v8:    { slots: ['v8_idle', 'v8_high'],   redline: 6000, start: 'engine_start_v8',  rev: 'rev' },
  v8b:   { slots: ['v8b_idle', 'v8b_high'], redline: 6200, start: 'engine_start_v8',  rev: 'rev' },
  i4:    { slots: ['i4_idle', 'i4_high'],   redline: 4800, start: 'engine_start',     rev: 'rev_i4' },
  rally: { slots: ['i4b_idle', 'i4_high'],  redline: 5200, start: 'engine_start',     rev: 'rev_i4' },
  old:   { slots: ['old_idle', 'old_high'], redline: 4600, start: 'engine_start_old', rev: 'rev_old' },
  el:    { slots: ['ev_whine'], hum: 'ev_hum', el: true },
};
PROFILES.standard = PROFILES.i4;

// Växlarnas toppfart (km/h) — varvtalet klättrar genom växeln och faller vid uppväxling
const GEAR_TOP = [55, 95, 140, 190, 250, 420];

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
    this.others = [null, null, null]; // grannbilarnas motorröster
    this.nyq = ctx.sampleRate / 2 - 200; // filterfrekvenser får inte passera Nyquist
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

  _one(slot, vol = 1, rate = 1, pan = 0) {
    const list = this.buf.get(slot);
    if (!list || !list.length) return false;
    const b = list[Math.floor(Math.random() * list.length)];
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      s.connect(g).connect(p).connect(this.bus);
    } else s.connect(g).connect(this.bus);
    s.start();
    return true;
  }

  // ---------- Motorröst (spelarens eller en grannes) ----------
  _voice(type) {
    const P = PROFILES[type] || PROFILES.standard;
    const slots = P.slots.filter(s => this.has(s));
    if (!slots.length) return null;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const out = this.ctx.createGain();
    out.gain.value = 0;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) lp.connect(out).connect(pan).connect(this.bus); else lp.connect(out).connect(this.bus);
    const layers = slots.map(s => {
      const L = this._loopLayer(s, lp);
      L.gain.gain.value = 1;
      return { slot: s, ...L, base: this.rpmOf[s] || (/idle/.test(s) ? 900 : 3000) };
    });
    const hum = P.hum && this.has(P.hum) ? this._loopLayer(P.hum, lp) : null;
    return { type, P, lp, out, pan, layers, hum, rpm: 900, gear: 0, shiftT: 0 };
  }

  _stopVoice(E) {
    if (!E) return;
    const t = this.ctx.currentTime;
    E.out.gain.setTargetAtTime(0, t, 0.05);
    for (const L of E.layers) { try { L.src.stop(t + 0.4); } catch { /* ok */ } }
    if (E.hum) { try { E.hum.src.stop(t + 0.4); } catch { /* ok */ } }
  }

  _updateVoice(E, kmh, th, pitch, dt, gainMul) {
    const now = this.ctx.currentTime;
    const P = E.P;
    if (P.el) {
      const L = E.layers[0];
      L.src.playbackRate.setTargetAtTime((0.5 + (kmh / 260) * 1.7) * pitch, now, 0.05);
      E.lp.frequency.setTargetAtTime(Math.min(this.nyq, 1500 + th * 9000), now, 0.08);
      const whine = 0.04 + Math.min(1, kmh / 170) * 0.34 + th * 0.08;
      L.gain.gain.setTargetAtTime(1, now, 0.05);
      if (E.hum) E.hum.gain.gain.setTargetAtTime(0.5 * (1 - Math.min(1, kmh / 40)), now, 0.1);
      E.out.gain.setTargetAtTime(gainMul * whine, now, 0.08);
      return;
    }
    // Växellåda
    const idle = 900, red = P.redline;
    let target;
    if (kmh < 6) target = idle + th * (red * 0.45);
    else {
      target = Math.max(idle, red * kmh / GEAR_TOP[E.gear]);
      if (target > red * 0.96 && E.gear < GEAR_TOP.length - 1) { E.gear++; E.shiftT = 0.14; }
      else if (E.gear > 0 && red * kmh / GEAR_TOP[E.gear - 1] < red * 0.62) { E.gear--; E.shiftT = 0.1; }
      target = Math.max(idle, red * kmh / GEAR_TOP[E.gear]);
      if (th < 0.05) target *= 0.92;
    }
    if (kmh < 3 && th < 0.05) E.gear = 0;
    E.rpm += (target - E.rpm) * Math.min(1, dt * (E.shiftT > 0 ? 18 : 9));
    E.shiftT = Math.max(0, E.shiftT - dt);
    const lo = E.layers[0].base * 1.45, hi = (E.layers[1]?.base || lo * 2) * 0.95;
    const blend = E.layers.length > 1 ? smooth(lo, hi, E.rpm) : 0;
    E.layers.forEach((L, i) => {
      const r = clamp(E.rpm / L.base, i === 0 ? 0.7 : 0.5, i === 0 ? 2.6 : 2.3) * pitch;
      L.src.playbackRate.setTargetAtTime(r, now, 0.03);
      const g = E.layers.length > 1 ? (i === 0 ? 1 - blend : blend) : 1;
      L.gain.gain.setTargetAtTime(Math.sqrt(g), now, 0.04); // lika-effekt-korsbledning
    });
    const dip = E.shiftT > 0 ? 0.45 : 1;
    E.lp.frequency.setTargetAtTime(Math.min(this.nyq, 900 + th * 7000 + blend * 3000), now, 0.06);
    E.out.gain.setTargetAtTime(gainMul * dip * (0.32 + th * 0.36 + blend * 0.14), now, 0.04);
  }

  // Anropas varje bildruta: spelarens bil + upp till 3 grannar {id, motor, pitch, kmh, dist, pan}
  drive(st, muted) {
    if (!this.ready) return false;
    const now = this.ctx.currentTime;
    const dt = clamp(now - this._lastT, 0.001, 0.1);
    this._lastT = now;
    const vol = muted ? 0 : 1;
    const type = PROFILES[st.motor] ? st.motor : 'standard';
    if (!this.eng || this.eng.type !== type) {
      this._stopVoice(this.eng);
      this.eng = this._voice(type);
      const P = PROFILES[type];
      if (this.eng && P.start && !muted) this._one(P.start, 0.6);
    }
    const kmh = Math.abs(st.kmh);
    const th = clamp(st.throttle, 0, 1);
    if (this.eng) this._updateVoice(this.eng, kmh, th, st.pitch || 1, dt, vol);

    // Grannbilarna: stabil tilldelning per bil-id
    const others = (st.others || []).slice(0, this.others.length);
    const keep = new Set(others.map(o => o.id));
    this.others.forEach((V, i) => {
      if (V && !keep.has(V.id)) { this._stopVoice(V); this.others[i] = null; }
    });
    for (const o of others) {
      let V = this.others.find(v => v && v.id === o.id);
      if (!V) {
        const idx = this.others.indexOf(null);
        if (idx < 0) continue;
        V = this._voice(PROFILES[o.motor] ? o.motor : 'standard');
        if (!V) continue;
        V.id = o.id;
        this.others[idx] = V;
      }
      const g = vol * 0.55 * Math.max(0, 1 - o.dist / 70) ** 1.5;
      this._updateVoice(V, o.kmh, 0.85, o.pitch || 1, dt, g);
      if (V.pan) V.pan.pan.setTargetAtTime(clamp(o.pan, -0.9, 0.9), now, 0.05);
    }

    // Däck, vind, rullning, skrap
    const slip = st.slip || 0;
    if (this.tire) {
      const g = st.grounded === false ? 0 : clamp((slip - 3) / 9, 0, 1) * 0.45;
      this.tire.gain.gain.setTargetAtTime(vol * g, now, 0.06);
      this.tire.src.playbackRate.setTargetAtTime(0.9 + clamp(slip / 60, 0, 0.3), now, 0.1);
    }
    if (this.wind) this.wind.gain.gain.setTargetAtTime(vol * Math.min(1, (kmh / 260) ** 2) * 0.32, now, 0.2);
    if (this.roll) this.roll.gain.gain.setTargetAtTime(vol * (st.grounded === false ? 0 : Math.min(1, kmh / 160) * 0.16), now, 0.1);
    if (this.scrape) this.scrape.gain.gain.setTargetAtTime(vol * (st.scrape ? clamp(0.3 + kmh / 300, 0, 0.65) : 0), now, 0.05);
    return true;
  }

  stopAll() {
    const t = this.ctx.currentTime;
    for (const E of [this.eng, ...this.others]) if (E) E.out.gain.setTargetAtTime(0, t, 0.05);
    for (const L of [this.tire, this.wind, this.roll, this.scrape]) if (L) L.gain.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---------- Engångsljud ----------
  crash(intensity, pan = 0) {
    if (!this.ready) return false;
    const heavy = intensity > 0.45;
    const slot = heavy && this.has('crash_heavy') ? 'crash_heavy' : (this.has('crash_light') ? 'crash_light' : 'crash_heavy');
    const ok = this._one(slot, clamp(0.35 + intensity * 0.95, 0, 1.25), 0.86 + Math.random() * 0.26, pan);
    if (heavy && Math.random() < 0.3) this._one('glass_shatter', 0.5 * intensity, 0.9 + Math.random() * 0.2, pan);
    return ok;
  }

  partOff(glas) {
    if (!this.ready) return false;
    if (glas && this._one('glass_shatter', 0.45, 0.9 + Math.random() * 0.25)) return true;
    return this._one('metal_debris', 0.55, 0.85 + Math.random() * 0.3);
  }

  boom(v = 1) { return this.ready && this._one('explosion', 0.95 * v, 0.9 + Math.random() * 0.15); }
  boost() { return this.ready && this._one('boost', 0.7); }
  launch(type, pitch = 1) {
    if (!this.ready) return false;
    const P = PROFILES[type] || PROFILES.standard;
    const a = P.rev ? this._one(P.rev, 0.55, pitch) : true;
    this._one('tire_screech', 0.3, 1.05);
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
