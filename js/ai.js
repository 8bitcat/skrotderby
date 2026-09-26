// Bot-förare: strosar i lobbyn, ställer upp bakom grindarna när starten närmar sig,
// följer banan i race (med catch-up-fart) och rammar närmsta offer i derbyt.
import * as THREE from 'three';
import { CARS, BOT_NAMES, AI_NIVAER } from './config.js?v=4';
import { Car, spawnY } from './vehicle.js?v=4';
import { pathPointAt } from './world.js?v=4';

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Bots {
  constructor(ctx, worldApi, raceMgr, niva = 'blandat') {
    this.ctx = ctx;
    this.world = worldApi;
    this.raceMgr = raceMgr;
    this.niva = niva;                 // 'latt' | 'medel' | 'svar' | 'blandat'
    this.list = [];
    this._nameI = 0;
    this._spawnI = 2;
    this._o = {};
    this._t = new THREE.Vector3();
  }

  _pickDiff(i) {
    if (this.niva !== 'blandat' && AI_NIVAER[this.niva]) return AI_NIVAER[this.niva];
    return [AI_NIVAER.latt, AI_NIVAER.medel, AI_NIVAER.svar][i % 3];
  }

  spawnAll(n) {
    for (let i = 0; i < n; i++) {
      const diff = this._pickDiff(i);
      const name = BOT_NAMES[this._nameI++ % BOT_NAMES.length] + ' ' + diff.tag;
      const bot = {
        name, diff, car: null, state: 'ROAM',
        target: new THREE.Vector3(), timer: rnd(2, 6),
        stuckT: 0, revT: 0, slot: null, zone: null, prey: null, preyT: 0,
        nT: rnd(0, 10), phase: rnd(0, 6.28),
      };
      bot.car = this._newCar(bot);
      this._roamTarget(bot);
      this.list.push(bot);
    }
  }

  // Bottar spawnar BAKOM startlinjen och jagar ikapp (catch-up gör resten)
  fillRace(zone, n) {
    const idle = this.list.filter(b => !b.car.racing && !b.car.wrecked && !b.car.disposed);
    let placed = 0;
    for (const bot of idle) {
      if (placed >= n) break;
      const car = bot.car;
      this._releaseSlot(bot);
      if (zone.mode === 'race') {
        pathPointAt(zone, zone.total - 26 - placed * 13, this._o);
        const heading = Math.atan2(-this._o.tx, -this._o.tz);
        car.resetTo(new THREE.Vector3(this._o.x + (placed % 2 ? 3.5 : -3.5), 1.4, this._o.z), heading);
      } else {
        const a = (placed / Math.max(1, n)) * Math.PI * 2;
        car.resetTo(new THREE.Vector3(zone.center.x + 24 * Math.cos(a), 1.4, zone.center.z + 24 * Math.sin(a)), a + Math.PI / 2);
      }
      this.raceMgr.enroll(zone, car, false);
      bot.state = 'RACE';
      placed++;
    }
    return placed;
  }

  _newCar(bot) {
    const defId = Math.floor(Math.random() * CARS.length);
    const def = CARS[defId];
    const sp = this.world.lobby.spawn(this._spawnI++);
    const pos = sp.pos.clone();
    pos.y = spawnY(def);
    const car = new Car(this.ctx, def, pos, sp.heading, { name: bot.name, defId });
    this.ctx.onSpawnCar?.(car);
    return car;
  }

  _roamTarget(bot) {
    const L = this.world.lobby.center;
    const a = Math.random() * Math.PI * 2, r = rnd(8, 50);
    bot.target.set(L.x + r * Math.cos(a), 0, L.z + r * Math.sin(a));
    bot.timer = rnd(4, 9);
  }

  update(dt) {
    for (const bot of this.list) {
      const car = bot.car;
      if (car.disposed) { bot.car = this._newCar(bot); bot.state = 'ROAM'; this._roamTarget(bot); continue; }
      if (car.wrecked) {
        this._releaseSlot(bot);
        if (car.deadT > rnd(4.5, 7)) {
          car.dispose();
          bot.car = this._newCar(bot);
          bot.state = 'ROAM';
          this._roamTarget(bot);
        }
        continue;
      }
      if (car.flipT > 2.5) car.resetUpright(!!car.racing && car.racing.mode === 'race');
      this._think(bot, dt);
    }
  }

  _releaseSlot(bot) {
    if (bot.zone && bot.slot != null) bot.zone.gridClaims.delete(bot.slot);
    bot.zone = null;
    bot.slot = null;
  }

  _pickZone() {
    const zs = this.raceMgr.zones.filter(z => !z.race);
    if (!zs.length) return null;
    if (zs.length === 1) return zs[0];
    return Math.random() < 0.6 ? zs[0] : zs[1];
  }

  _freeSlot(z) {
    for (let i = 0; i < z.grid.length; i++) if (!z.gridClaims.has(i)) return i;
    return null;
  }

  _nearestPrey(car, z) {
    let best = null, bd = Infinity;
    for (const c of z.race.parts.keys()) {
      if (c === car || c.wrecked || c.disposed) continue;
      const d = dist2d(car.pos, c.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _think(bot, dt) {
    const car = bot.car, rm = this.raceMgr;
    if (car.racing && bot.state !== 'RACE') { bot.state = 'RACE'; this._releaseSlot(bot); }

    switch (bot.state) {
      case 'ROAM': {
        bot.timer -= dt;
        this._driveTo(bot, car, bot.target, dt, 0.5);
        if (bot.timer <= 0 || dist2d(car.pos, bot.target) < 6) this._roamTarget(bot);
        if (rm.tLeft < 45 && rm.tLeft > 6 && Math.random() < dt * 0.9) {
          const z = this._pickZone();
          if (z) {
            const slot = this._freeSlot(z);
            if (slot != null) {
              bot.zone = z; bot.slot = slot;
              z.gridClaims.add(slot);
              // Teleportera RAKT till startrutan — bottar ska aldrig fastna på vägen
              const g = z.grid[slot];
              car.resetTo(new THREE.Vector3(g.pos.x, 1.4, g.pos.z), g.heading);
              bot.state = 'WAIT';
            }
          }
        }
        break;
      }
      case 'TO_GRID': { // legacy-läge — ska inte inträffa, men studsa hem säkert
        bot.state = 'ROAM';
        this._roamTarget(bot);
        break;
      }
      case 'WAIT': {
        car.input.throttle = car.speed > 0.6 ? -0.5 : 0;
        car.input.steer = 0;
        car.input.handbrake = false;
        // Missade starten (grindarna gick utan oss)? Tillbaka till lobbyn.
        if (bot.zone?.race && !car.racing && bot.zone.race.t > 8) {
          this._releaseSlot(bot);
          bot.state = 'ROAM';
          this._roamTarget(bot);
        }
        break;
      }
      case 'RACE': {
        if (!car.racing) {
          bot.state = 'ROAM';
          this._releaseSlot(bot);
          this._roamTarget(bot);
          break;
        }
        const z = car.racing;
        if (z.mode === 'race') {
          const p = z.race?.parts.get(car);
          const param = p ? p.lastParam : 0;
          const look = (10 + car.absSpeed * 0.55) * bot.diff.look;
          pathPointAt(z, param + look, this._o);
          this._t.set(this._o.x, 0, this._o.z);
          this._driveTo(bot, car, this._t, dt, 1);
        } else {
          bot.preyT -= dt;
          if (bot.preyT <= 0 || !bot.prey || bot.prey.wrecked || bot.prey.disposed) {
            bot.prey = this._nearestPrey(car, z);
            bot.preyT = 1.2;
          }
          if (bot.prey) {
            this._t.copy(bot.prey.pos);
            this._driveTo(bot, car, this._t, dt, 1);
          } else {
            this._t.set(z.center.x, 0, z.center.z);
            this._driveTo(bot, car, this._t, dt, 0.6);
          }
        }
        break;
      }
    }
  }

  _driveTo(bot, car, target, dt, aggr) {
    const dx = target.x - car.pos.x, dz = target.z - car.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    let fx = car.fwd.x, fz = car.fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const dot = (dx * fx + dz * fz);
    const crossY = fz * dx - fx * dz;
    const ang = Math.atan2(crossY, dot);

    let steer = Math.max(-1, Math.min(1, ang * 1.6));
    let throttle;
    if (Math.abs(ang) > 2.4 && car.absSpeed < 4) {
      throttle = -0.7;
      steer = -Math.sign(ang);
    } else if (Math.abs(ang) > 1.1 && car.speed > 14) {
      throttle = -0.3;
    } else {
      throttle = aggr * (Math.abs(ang) > 1.1 ? 0.45 : 1);
    }

    // Svårighetsgrad: gasfot + styrslarv
    if (throttle > 0) throttle *= bot.diff.gas;
    bot.nT += dt;
    steer += Math.sin(bot.nT * 2.1 + bot.phase) * bot.diff.brus * Math.min(1, car.absSpeed / 15);

    // Fastkörningsskydd: backa en stund och vrid åt andra hållet
    if (car.absSpeed < 0.9 && throttle > 0.3) bot.stuckT += dt;
    else bot.stuckT = Math.max(0, bot.stuckT - dt * 2);
    if (bot.stuckT > 2.2) { bot.revT = 1.3; bot.stuckT = 0; }
    if (bot.revT > 0) {
      bot.revT -= dt;
      throttle = -1;
      steer = -steer;
    }

    car.input.throttle = throttle;
    car.input.steer = Math.max(-1, Math.min(1, steer));
    car.input.handbrake = false;
  }
}
