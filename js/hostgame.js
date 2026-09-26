// Värdens spelloop: äger Rapier-världen, alla bilar (egen, bottar, gäster),
// skador, race-logik och nätsnapshots.
import * as THREE from 'three';
import { CONF, CARS } from './config.js';
import { Car, spawnY } from './vehicle.js';
import { buildWorld } from './world.js';
import { RaceManager } from './race.js';
import { Bots } from './ai.js';
import { Hud } from './hud.js';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const yawOf = (car) => Math.atan2(-car.fwd.x, -car.fwd.z);

export class HostGame {
  constructor(app, { RAPIER, defId, name, net }) {
    this.app = app;
    this.net = net;

    const world = new RAPIER.World({ x: 0, y: -CONF.GRAV, z: 0 });
    world.timestep = CONF.DT;

    this.ctx = {
      scene: app.scene, world, RAPIER,
      particles: app.particles, audio: app.audio,
      allCars: [], carsByCollider: new Map(), noDmg: new Set(),
      loose: [],
      addLoose: (e) => this._addLoose(e),
      raceMgr: null,
      onDetach: (car, part, pos, vel) => this.net?.broadcast({
        t: 'los', id: car.id, part,
        x: r2(pos.x), y: r2(pos.y), z: r2(pos.z),
        vx: r1(vel.x), vy: r1(vel.y), vz: r1(vel.z),
      }),
      onWreck: (car) => this.notify(car, 'announce', '💀 DIN BIL SKROTADES!'),
      onBoom: (car) => this.net?.broadcast({ t: 'boom', id: car.id }),
      onSpawnCar: (car) => this.broadcastSpawn(car),
      onDespawnCar: (car) => this.net?.broadcast({ t: 'despawn', id: car.id }),
    };

    this.worldApi = buildWorld(this.ctx);
    const rmCtx = {
      allCars: this.ctx.allCars,
      notify: (car, kind, text) => this.notify(car, kind, text),
      notifyAll: (kind, text, snd) => this.notifyAll(kind, text, snd),
    };
    this.raceMgr = new RaceManager(rmCtx, this.worldApi.zones);
    this.ctx.raceMgr = this.raceMgr;

    this.bots = new Bots(this.ctx, this.worldApi, this.raceMgr);
    this.bots.spawnAll(CONF.BOTS);

    this.player = this.spawnFor('local', name, defId, 0);
    this.playerPadT = 0;
    this.remotePlayers = new Map();
    this.acc = 0; this.simT = 0; this.snapT = 0;

    if (net) {
      net.handlers.onData = (id, msg) => this.onNetData(id, msg);
      net.handlers.onLeave = (id) => this.onNetLeave(id);
    }
    app.cam.snap(this.player.pos);
  }

  spawnFor(owner, name, defId, spawnIdx, id) {
    const def = CARS[defId] ?? CARS[0];
    const sp = this.worldApi.lobby.spawn(spawnIdx);
    const pos = sp.pos.clone();
    pos.y = spawnY(def);
    const car = new Car(this.ctx, def, pos, sp.heading, { owner, name, defId, id });
    this.broadcastSpawn(car);
    return car;
  }

  broadcastSpawn(car) {
    this.net?.broadcast({ t: 'spawn', id: car.id, defId: car.defId, name: car.name });
  }

  swapCar(car, defId) {
    const { id, owner, name } = car;
    const pos = car.pos.clone();
    const heading = yawOf(car);
    car.dispose();
    const def = CARS[defId];
    pos.y = spawnY(def) + 0.2;
    const nc = new Car(this.ctx, def, pos, heading, { id, owner, name, defId });
    this.broadcastSpawn(nc);
    return nc;
  }

  trySwap(car, defId) {
    if (car.wrecked || car.disposed || defId < 0 || defId >= CARS.length) return car;
    if (car.racing) { this.notify(car, 'toast', 'Du kan inte byta bil mitt i ett lopp'); return car; }
    if (car.defId === defId) return car;
    const nc = this.swapCar(car, defId);
    this.notify(nc, 'toast', 'Ny bil: ' + nc.def.namn);
    this.ctx.particles.sparks(nc.pos, 25, 0x8ecfff, 8);
    if (nc.owner === 'local') this.player = nc;
    else if (nc.owner) {
      const rp = this.remotePlayers.get(nc.owner);
      if (rp) rp.car = nc;
    }
    return nc;
  }

  tryReset(car) {
    if (car.wrecked || car.disposed) return;
    if (car.up.y < 0.5 || car.absSpeed < 2.5) car.resetUpright(false);
  }

  notify(car, kind, text) {
    if (car.owner === 'local') {
      if (kind === 'toast') this.app.hud.toast(text);
      else this.app.hud.announce(text);
    } else if (car.owner) {
      this.net?.sendTo(car.owner, { t: 'msg', kind, text });
    }
  }

  notifyAll(kind, text, snd) {
    if (kind === 'toast') this.app.hud.toast(text);
    else this.app.hud.announce(text);
    if (snd === 'start') this.app.audio.raceStart();
    if (snd === 'win') this.app.audio.win();
    this.net?.broadcast({ t: 'msg', kind, text, snd });
  }

  // ---------- Nätet ----------
  onNetData(id, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hej': {
        const defId = clamp(msg.defId | 0, 0, CARS.length - 1);
        const name = String(msg.name || 'Gäst').slice(0, 12);
        const car = this.spawnFor(id, name, defId, 4 + this.remotePlayers.size);
        this.remotePlayers.set(id, { car, padT: 0 });
        this.net.sendTo(id, {
          t: 'valkommen', dinBil: car.id,
          cars: this.ctx.allCars.map(c => ({ id: c.id, defId: c.defId, name: c.name })),
        });
        this.notifyAll('toast', '🚗 ' + name + ' gick med!');
        break;
      }
      case 'input': {
        const rp = this.remotePlayers.get(id);
        if (rp && !rp.car.wrecked && !rp.car.disposed) {
          rp.car.input.throttle = clamp(+msg.g || 0, -1, 1);
          rp.car.input.steer = clamp(+msg.s || 0, -1, 1);
          rp.car.input.handbrake = !!msg.h;
        }
        break;
      }
      case 'reset': {
        const rp = this.remotePlayers.get(id);
        if (rp) this.tryReset(rp.car);
        break;
      }
      case 'byt': {
        const rp = this.remotePlayers.get(id);
        if (rp) this.trySwap(rp.car, msg.defId | 0);
        break;
      }
    }
  }

  onNetLeave(id) {
    const rp = this.remotePlayers.get(id);
    if (!rp) return;
    this.notifyAll('toast', rp.car.name + ' lämnade spelet');
    if (!rp.car.disposed) rp.car.dispose();
    this.remotePlayers.delete(id);
  }

  snapshot() {
    const cars = this.ctx.allCars.map((c) => {
      const st = this.raceMgr.getStatus(c);
      return [
        c.id, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z),
        r3(c.quat.x), r3(c.quat.y), r3(c.quat.z), r3(c.quat.w),
        r2(c.steerCur), Math.round(Math.abs(c.speed) * 3.6),
        Math.round(100 * Math.max(0, c.health) / c.maxHealth),
        (c.wrecked ? 1 : 0) | (c.exploded ? 2 : 0) | (c.turboT > 0 ? 4 : 0),
        c.partMask(), c.wheelMask(), Math.round(c.score),
        st ? (st.mode === 'race' ? [1, st.lap, st.laps, st.place, st.n] : [2, st.kvar, Math.round(st.t)]) : 0,
      ];
    });
    const props = [];
    this.worldApi.props.forEach((p, i) => {
      if (p.body && !p.body.isSleeping()) {
        const t = p.body.translation(), r = p.body.rotation();
        props.push([i, r2(t.x), r2(t.y), r2(t.z), r3(r.x), r3(r.y), r3(r.z), r3(r.w)]);
      }
    });
    return {
      t: 'snap', time: r2(this.simT), tLeft: r1(this.raceMgr.tLeft),
      zr: this.worldApi.zones.map(z => (z.race ? 1 : 0) | (z.gatesOpen ? 2 : 0)),
      cars, props,
    };
  }

  // ---------- Fysik ----------
  fixedStep(dt) {
    for (const c of this.ctx.allCars) c.physicsStep(dt);
    this.raceMgr.stepGates(dt);
    this.ctx.world.step();
    this.damageScan();
  }

  // Δv-baserad skadedetektering: plötslig hastighetsändring på ett steg = smäll.
  // Ren vertikal smäll utan bil i närheten = hård landning → gratis.
  damageScan() {
    const cars = this.ctx.allCars;
    for (const car of cars) {
      if (car.disposed || car.wrecked) continue;
      const lv = car.body.linvel();
      const dvx = lv.x - car.vel.x;
      const dvy = lv.y - car.vel.y + CONF.GRAV * CONF.DT;
      const dvz = lv.z - car.vel.z;
      const dv = Math.hypot(dvx, dvy, dvz);
      if (dv < CONF.DV_MIN) continue;

      // Närmsta andra bil inom kontaktavstånd = tacklaren
      let attacker = null, bd = 1e9;
      for (const o of cars) {
        if (o === car || o.disposed) continue;
        const d = Math.hypot(o.pos.x - car.pos.x, o.pos.y - car.pos.y, o.pos.z - car.pos.z);
        const reach = (o.def.dims.l + car.def.dims.l) * 0.5 + 1.2;
        if (d < reach && d < bd) { bd = d; attacker = o; }
      }
      if (!attacker && Math.abs(dvy) > 0.72 * dv) continue; // landning

      const dmg = Math.min(CONF.DMG_MAX, (dv - CONF.DV_MIN) * CONF.DV_SCALE);
      if (dmg <= 0.5) continue;
      // Träffpunkt: på sidan knuffen kom ifrån
      const inv = 1 / dv;
      const point = {
        x: car.pos.x - dvx * inv * car.def.dims.l * 0.45,
        y: car.pos.y - dvy * inv * car.def.dims.h * 0.3,
        z: car.pos.z - dvz * inv * car.def.dims.l * 0.45,
      };
      const applied = car.applyDamage(dmg, point, attacker);
      if (applied > 0) {
        this.ctx.particles.sparks(point, Math.round(4 + applied), 0xffb347, 7 + applied * 0.3);
        const d = Math.hypot(point.x - this.player.pos.x, point.z - this.player.pos.z);
        this.app.audio.crash(Math.min(1, applied / 22) * Math.max(0.15, 1 - d / 120));
        this.net?.broadcast({ t: 'dmg', x: r1(point.x), y: r1(point.y), z: r1(point.z), i: Math.round(applied) });
        // Riktigt hård tackling → offret lättar från marken
        if (attacker && dv > 12) {
          car.body.applyImpulse({ x: 0, y: car.def.mass * CONF.LAUNCH_JUICE, z: 0 }, true);
        }
      }
    }
  }

  // ---------- Lösa delar & rekvisita ----------
  _addLoose(e) {
    this.ctx.loose.push(e);
    if (this.ctx.loose.length > CONF.MAX_LOOSE) this._removeLoose(0);
  }

  _removeLoose(i) {
    const e = this.ctx.loose[i];
    this.ctx.scene.remove(e.mesh);
    this.ctx.world.removeRigidBody(e.body);
    this.ctx.loose.splice(i, 1);
  }

  updateLoose(dt) {
    for (let i = this.ctx.loose.length - 1; i >= 0; i--) {
      const e = this.ctx.loose[i];
      e.life -= dt;
      if (e.life <= 0) { this._removeLoose(i); continue; }
      const t = e.body.translation(), r = e.body.rotation();
      e.mesh.position.set(t.x, t.y, t.z);
      e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (e.life < 1) e.mesh.scale.setScalar(Math.max(0.01, e.life));
    }
  }

  updateProps() {
    for (const p of this.worldApi.props) {
      if (!p.body) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // ---------- Spelarhjälp ----------
  handleWipeouts() {
    for (const c of this.ctx.allCars) {
      if (c.owner === null || c.wrecked || c.disposed) continue; // bottar sköts av AI:n
      const inRace = c.racing && c.racing.mode === 'race';
      if (inRace && c.flipT > 2.2) {
        c.resetUpright(true);
        this.notify(c, 'announce', 'WIPEOUT! Comeback-turbo ⚡ — sist åker fortast!');
      } else if (!c.racing && c.flipT > 3.5) {
        c.resetUpright(false);
      }
      // I derbyt: ingen automatik — ligger du på taket får du trycka R och be en bön
    }
  }

  handleRespawns() {
    const respawn = (car, assign) => {
      if (!car.wrecked || car.deadT < 3.5) return car;
      const { id, owner, name, defId } = car;
      car.dispose();
      const nc = this.spawnFor(owner, name, defId, Math.floor(Math.random() * 10), id);
      this.notify(nc, 'toast', 'Ny bil framkörd i depån!');
      assign(nc);
      return nc;
    };
    respawn(this.player, (nc) => { this.player = nc; });
    for (const rp of this.remotePlayers.values()) {
      respawn(rp.car, (nc) => { rp.car = nc; });
    }
  }

  handlePads(dt) {
    const check = (car, store) => {
      if (car.wrecked || car.disposed || car.racing) { store.padT = 0; return; }
      let onPad = null;
      for (const pad of this.worldApi.lobby.pads) {
        if (Math.hypot(car.pos.x - pad.pos.x, car.pos.z - pad.pos.z) < 2.7 && car.absSpeed < 3.5) {
          onPad = pad;
          break;
        }
      }
      if (onPad && onPad.defId !== car.defId) {
        store.padT += dt;
        if (store.padT > 1.1) { store.padT = 0; this.trySwap(car, onPad.defId); }
      } else store.padT = 0;
    };
    check(this.player, this._pStore ??= { padT: 0 });
    for (const rp of this.remotePlayers.values()) check(rp.car, rp);
  }

  // ---------- Huvudloop ----------
  update(dt) {
    const { input, hud, audio, cam, sun } = this.app;

    if (!this.player.wrecked) Object.assign(this.player.input, input.playerInput());
    else this.player.input = { throttle: 0, steer: 0, handbrake: false };
    if (input.take('KeyR')) this.tryReset(this.player);
    if (input.take('KeyC')) cam.toggle();
    if (input.take('KeyM')) hud.toast(audio.toggleMute() ? 'Ljud av 🔇' : 'Ljud på 🔊');
    for (let i = 0; i < CARS.length; i++) {
      if (input.take('Digit' + (i + 1))) this.trySwap(this.player, i);
    }

    this.acc += Math.min(dt, 0.06);
    while (this.acc >= CONF.DT) {
      this.fixedStep(CONF.DT);
      this.acc -= CONF.DT;
      this.simT += CONF.DT;
    }

    this.bots.update(dt);
    this.raceMgr.update(dt);
    this.handleWipeouts();
    this.handleRespawns();
    this.handlePads(dt);

    for (const c of this.ctx.allCars) c.update(dt);
    this.updateLoose(dt);
    this.updateProps();
    this.worldApi.updateVisuals(dt, this.simT);
    this.worldApi.updateBoards(
      this.raceMgr.tLeft,
      !!this.worldApi.zones[0].race,
      !!this.worldApi.zones[1].race
    );
    this.app.particles.update(dt);

    const p = this.player;
    const kmh = Math.abs(p.speed) * 3.6;
    cam.update(dt, p.pos, p.fwd, kmh);
    sun.position.set(p.pos.x + 80, 120, p.pos.z + 40);
    sun.target.position.set(p.pos.x, 0, p.pos.z);
    sun.target.updateMatrixWorld();
    audio.setEngine(Math.min(1, Math.abs(p.speed) / 50), p.input.throttle);
    hud.update({
      kmh,
      health01: p.health / p.maxHealth,
      carName: p.def.namn + (p.turboT > 0 ? ' ⚡' : ''),
      score: p.score,
      raceText: Hud.raceText(this.raceMgr.getStatus(p), this.raceMgr.tLeft),
    });

    if (this.net) {
      this.snapT += dt;
      if (this.snapT > 1 / 15) {
        this.snapT = 0;
        this.net.broadcast(this.snapshot());
      }
    }
  }
}
