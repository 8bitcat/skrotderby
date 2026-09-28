// Race- och derbylogik (körs på värden).
// Varje minut öppnas grindarna för den som står i depåfickan — och man kan
// alltid köra in mitt i ett pågående race/derby och vara med direkt.
// CATCH-UP: sämre placering = högre fart, så fältet klumpar ihop sig.
import { CONF } from './config.js?v=18';
import { stepGates, pathPointAt } from './world.js?v=18';
import { spotFree } from './vehicle.js?v=18';

export function nearestParam(zone, p, hint = -1) {
  const pts = zone.pts, n = pts.length;
  let bd2 = Infinity, bParam = 0, bIdx = 0;
  const check = (i) => {
    const a = pts[i], b = pts[(i + 1) % n];
    const abx = b.x - a.x, abz = b.z - a.z;
    const L2 = abx * abx + abz * abz || 1e-9;
    let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + abx * t), dz = p.z - (a.z + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < bd2) { bd2 = d2; bIdx = i; bParam = zone.cum[i] + Math.sqrt(L2) * t; }
  };
  if (hint >= 0) {
    for (let k = -3; k <= 3; k++) check(((hint + k) % n + n) % n);
    if (bd2 < zone.width * zone.width) return { param: bParam, idx: bIdx, dist: Math.sqrt(bd2) };
    bd2 = Infinity;
  }
  for (let i = 0; i < n; i++) check(i);
  return { param: bParam, idx: bIdx, dist: Math.sqrt(bd2) };
}

const inAABB = (b, p) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;

export class RaceManager {
  constructor(ctx, zones) {
    this.ctx = ctx;
    this.zones = zones;
    for (const z of zones) z.gridClaims = new Set();
    this.clock = CONF.RACE_INTERVAL - 25; // första starten efter ~25 s
    this.tLeft = 25;
    this._joinT = 0;
    this._rankT = 0;
  }

  update(dt) {
    const cars = this.ctx.allCars;
    const prev = this.tLeft;
    this.clock += dt;
    this.tLeft = CONF.RACE_INTERVAL - (this.clock % CONF.RACE_INTERVAL);
    if (this.tLeft > prev) for (const z of this.zones) this.tryStart(z, cars);

    this._joinT += dt;
    const doJoin = this._joinT > 0.4;
    if (doJoin) this._joinT = 0;
    this._rankT += dt;
    const doRank = this._rankT > 0.3;
    if (doRank) this._rankT = 0;

    for (const z of this.zones) {
      if (z.extraGateT > 0) {
        z.extraGateT -= dt;
        if (z.extraGateT <= 0 && z.race && z.race.t > 10) z.gatesOpen = false;
      }
      if (z.race) {
        z.race.t += dt;
        // Stäng inte grindarna så länge deltagare står kvar i fållan (max 25 s)
        if (z.gatesOpen && z.race.t > 10 && z.extraGateT <= 0) {
          const kvarIFallan = [...z.race.parts.entries()].some(([c, p]) =>
            !p.finished && !c.wrecked && !c.disposed && inAABB(z.staging, c.pos));
          if (!kvarIFallan || z.race.t > 25) z.gatesOpen = false;
        }
        if (z.mode === 'race') this.updateRaceMode(z, dt, doRank);
        else this.updateDerby(z);
        if (doJoin && z.race) this.joinScan(z, cars);
      }
    }
  }

  stepGates(dt) {
    for (const z of this.zones) stepGates(z, dt);
  }

  tryStart(z, cars) {
    const staged = cars.filter(c => !c.wrecked && !c.disposed && !c.racing && !c.isTraffic && inAABB(z.staging, c.pos));
    if (z.race) {
      // Race pågår redan — men den som står i depån släpps in i det (grindarna öppnas en stund)
      if (staged.length) { z.gatesOpen = true; z.extraGateT = 12; }
      return;
    }
    z.gridClaims.clear();
    if (!staged.length) return;
    if (z.mode === 'race') this.ctx.applyVariant?.(); // banröstningens vinnare byggs in
    z.race = { t: 0, parts: new Map(), finishOrder: [], count: 0 };
    z.gatesOpen = true;
    for (const c of staged) this.enroll(z, c, false);
    // Färre än FILL_MIN? Bottar spawnar bakom fältet och jagar ikapp
    if (z.mode === 'race' && z.race.parts.size < CONF.FILL_MIN) {
      const added = this.ctx.fillBots?.(z, CONF.FILL_MIN - z.race.parts.size) || 0;
      if (added) this.ctx.notifyAll('toast', '🤖 ' + added + ' bottar hoppar in bakifrån!');
    }
    this.ctx.notifyAll('toast', (z.mode === 'race' ? '🏁 Race' : '💥 Derby') + ' startade på ' + z.namn + '!', 'start');
    for (const c of staged) {
      if (c.owner !== null) {
        this.ctx.notify(c, 'announce', z.mode === 'race' ? 'GRINDARNA ÄR ÖPPNA — KÖR!' : 'SLÅ SÖNDER ALLT! 💥');
      }
    }
  }

  enroll(z, car, late, travel = null) {
    const p = { travel: 0, lastParam: 0, idx: 0, finished: false, place: 0, offT: 0, stageT: 0 };
    if (travel != null) p.travel = travel;
    if (z.mode === 'race') {
      const np = nearestParam(z, car.pos, -1);
      p.lastParam = np.param;
      p.idx = np.idx;
    }
    z.race.parts.set(car, p);
    z.race.count++;
    car.racing = z;
    if (late && car.owner !== null) {
      this.ctx.notify(car, 'announce', z.mode === 'race' ? 'DU ÄR MED I RACET!' : 'VÄLKOMMEN IN I DERBYT! 💥');
    }
  }

  updateRaceMode(z, dt, doRank) {
    const r = z.race;
    for (const [car, p] of r.parts) {
      if (p.finished || car.wrecked || car.disposed) continue;
      // Står man kvar i fållan efter starten åker man ur — racet ska inte vänta i evighet
      if (inAABB(z.staging, car.pos)) {
        p.stageT += dt;
        if (p.stageT > 15) { this.leave(z, car, 'Du missade starten — ute ur racet'); continue; }
      }
      const np = nearestParam(z, car.pos, p.idx);
      p.idx = np.idx;
      let d = np.param - p.lastParam;
      if (d > z.total / 2) d -= z.total;
      if (d < -z.total / 2) d += z.total;
      p.travel += d;
      p.lastParam = np.param;


      if (p.travel >= z.raceDist) {
        p.finished = true;
        r.finishOrder.push(car);
        p.place = r.finishOrder.length;
        car.speedMult = 1;
        car.raceVmax = null; car.racePower = null;
        car.racing = null;
        car.raceCooldown = 6;
        if (p.place === 1) r.closeAt = r.t + CONF.CLOSE_AFTER_WIN; // racet stänger 20 s efter ettan
        if (car.owner !== null) {
          this.ctx.notify(car, 'announce', '🏁 MÅL! Du kom ' + p.place + ':a!');
          if (p.place === 1) this.ctx.notifyAll('toast', '🏆 ' + car.name + ' vann racet på ' + z.namn + '!', 'win');
        } else if (p.place === 1) {
          this.ctx.notifyAll('toast', '🏆 ' + car.name + ' vann racet på ' + z.namn + '!', 'win');
        }
      }
    }

    if (doRank) {
      const active = [...r.parts.entries()].filter(([c, p]) => !p.finished && !c.wrecked && !c.disposed);
      active.sort((a, b) => b[1].travel - a[1].travel);
      const n = active.length;
      const lead = n ? active[0][1].travel : 0;
      active.forEach(([c, p], i) => {
        p.place = r.finishOrder.length + i + 1;
        // FARTSTEGEN: ettan 210, tvåan 219, trean 228 … — man kommer ALLTID ikapp.
        // Stort gap ger dessutom gummiband-bonus så klungan sluter sig.
        const gapBonus = Math.min(70, Math.max(0, (lead - p.travel) - 60) * CONF.RACE_GAP_BONUS);
        const steg = Math.min(i, 6); // stegen planar ut — inga 500 km/h-raketer längst bak
        c.raceVmax = (CONF.RACE_VMAX_BAS + steg * CONF.RACE_VMAX_STEG + gapBonus) / 3.6;
        c.racePower = 1 + steg * CONF.RACE_POWER_STEG + gapBonus * 0.006;
        c.speedMult = 1;
      });
      if (n > 7) this.packWarp(z, r, active);
      if (n > 0 && r.closeAt == null && r.t > 8 && r.t < z.maxT - 30 && n < CONF.FILL_MIN &&
          (r.lastFill == null || r.t - r.lastFill > 6)) {
        r.lastFill = r.t;
        this.ctx.fillBots?.(z, CONF.FILL_MIN - n);
      }
      if (n === 0 || r.t > z.maxT || (r.closeAt != null && r.t >= r.closeAt)) this.endRace(z);
    }
  }

  // Osynligt gummiband: bottar långt efter täten, som ingen människa ser,
  // lyfts upp bakom tätklungan — så det alltid är en klunga runt 1:an.
  packWarp(z, r, active) {
    // Ankare = främsta MÄNNISKAN i loppet (annars ettan): bottar lyfts aldrig
    // förbi en spelare — de hamnar bakom och får köra ikapp på riktigt.
    const human = active.find(([c]) => c.owner !== null);
    const [leadCar, leadP] = human || active[0];
    const humans = this.ctx.allCars.filter(c => c.owner !== null && !c.disposed);
    const seen = (x, zz, lim) => humans.some(h => Math.hypot(h.pos.x - x, h.pos.z - zz) < lim);
    const o = {};
    let warps = 0;
    for (let i = 1; i < active.length && warps < 2; i++) {
      const [c, p] = active[i];
      if (c.owner !== null || c.wrecked) continue;
      if (leadP.travel - p.travel < 500) continue; // bara de som ligger långt BAKOM ankaret
      if (p.warpT != null && r.t - p.warpT < 6) continue;
      if (seen(c.pos.x, c.pos.z, 300)) continue;
      for (const off of [110, 170, 240, 320, 420]) {
        pathPointAt(z, leadP.lastParam - off, o);
        if (seen(o.x, o.z, 160)) continue;
        let lane = null;
        for (const l of [0, -7, 7, -13, 13, -3.5, 3.5]) {
          if (spotFree(this.ctx.allCars, o.x - o.tz * l, o.z + o.tx * l, 6, c)) { lane = l; break; }
        }
        if (lane === null) continue;
        c.resetTo({ x: o.x - o.tz * lane, y: 1.5, z: o.z + o.tx * lane }, Math.atan2(-o.tx, -o.tz));
        const v = Math.max(35, leadCar.absSpeed);
        c.body.setLinvel({ x: o.tx * v, y: 0, z: o.tz * v }, true);
        p.travel = Math.max(0, leadP.travel - off);
        p.lastParam = ((leadP.lastParam - off) % z.total + z.total) % z.total;
        p.idx = -1;
        p.warpT = r.t;
        warps++;
        break;
      }
    }
  }

  updateDerby(z) {
    const r = z.race;
    const alive = [...r.parts.keys()].filter(c => !c.wrecked && !c.disposed);
    if (r.t > 8) {
      if (r.count >= 2 && alive.length === 1) {
        const w = alive[0];
        this.ctx.notifyAll('toast', '🏆 ' + w.name + ' vann derbyt — sista bilen som rullar!', 'win');
        if (w.owner !== null) this.ctx.notify(w, 'announce', '🏆 SISTA BILEN SOM RULLAR — DU VANN!');
        return this.endRace(z);
      }
      if (alive.length === 0) return this.endRace(z);
    }
    if (r.t > z.maxT) {
      let best = null;
      for (const c of alive) if (!best || c.score > best.score) best = c;
      if (best) this.ctx.notifyAll('toast', '⏱ Derbyt över — ' + best.name + ' hade flest skrotpoäng!', 'win');
      return this.endRace(z);
    }
  }

  joinScan(z, cars) {
    for (const car of cars) {
      if (car.racing || car.wrecked || car.disposed || car.raceCooldown > 0 || car.isTraffic) continue;
      if (z.race.parts.has(car)) continue;
      if (z.mode === 'race') {
        const np = nearestParam(z, car.pos, -1);
        if (np.dist < z.width / 2 - 1) this.enroll(z, car, true);
      } else {
        const dx = car.pos.x - z.center.x, dz = car.pos.z - z.center.z;
        if (Math.hypot(dx, dz) < z.radius - 2) this.enroll(z, car, true);
      }
    }
  }

  leave(z, car, msg) {
    z.race.parts.delete(car);
    car.racing = null;
    car.speedMult = 1;
    car.raceVmax = null; car.racePower = null;
    car.raceCooldown = 4;
    if (car.owner !== null && msg) this.ctx.notify(car, 'toast', msg);
  }

  endRace(z) {
    const r = z.race;
    for (const [car] of r.parts) {
      if (car.racing === z) { car.racing = null; car.speedMult = 1; car.raceVmax = null; car.racePower = null; }
    }
    z.race = null;
    z.gatesOpen = false;
    if (z.mode === 'race') this.restage(z, r);
  }

  // Alla från loppet lyfts tillbaka till startfållan (startordning = målordning)
  // och nästa start kommer om RESTAGE_WAIT sekunder.
  restage(z, r) {
    const done = new Set(r.finishOrder);
    const rest = [...r.parts.entries()]
      .filter(([c]) => !done.has(c))
      .sort((a, b) => b[1].travel - a[1].travel)
      .map(([c]) => c);
    const order = [...r.finishOrder, ...rest].filter(c => !c.wrecked && !c.disposed);
    z.gridClaims.clear();
    order.slice(0, z.grid.length).forEach((car, i) => {
      const g = z.grid[i];
      car.resetTo({ x: g.pos.x, y: 1.6, z: g.pos.z }, g.heading);
      car.raceCooldown = 0;
      car.returnHome = 0;
      z.gridClaims.add(i);
      this.ctx.restaged?.(car, z, i);
      if (car.owner !== null) this.ctx.notify(car, 'announce', '🏁 TILLBAKA I STARTFÅLLAN — NÄSTA START OM ' + CONF.RESTAGE_WAIT + ' S');
    });
    // Ställ klockan så att nästa minut-tick kommer om RESTAGE_WAIT s
    const I = CONF.RACE_INTERVAL;
    this.clock = (Math.floor(this.clock / I) + 1) * I - CONF.RESTAGE_WAIT;
    this.tLeft = CONF.RESTAGE_WAIT;
    this.ctx.notifyAll('toast', '🏁 Racet är slut — alla till startfållan, ny start om ' + CONF.RESTAGE_WAIT + ' s!');
  }

  dropCar(car) {
    for (const z of this.zones) z.race?.parts.delete(car);
    if (car.racing) car.racing = null;
  }

  getStatus(car) {
    const z = car.racing;
    if (!z || !z.race) return null;
    const p = z.race.parts.get(car);
    if (!p) return null;
    if (z.mode === 'race') {
      return { mode: 'race', dist: Math.max(0, p.travel), total: z.raceDist, place: p.place || 0, n: z.race.parts.size };
    }
    const kvar = [...z.race.parts.keys()].filter(c => !c.wrecked && !c.disposed).length;
    return { mode: 'derby', kvar, t: Math.max(0, z.maxT - z.race.t) };
  }
}
