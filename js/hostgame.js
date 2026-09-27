// Värdens spelloop: äger Rapier-världen, alla bilar (egen, bottar, gäster),
// skador, race-logik och nätsnapshots.
import * as THREE from 'three';
import { CONF, CARS, PROTO } from './config.js?v=9';
import { Car, spawnY } from './vehicle.js?v=9';
import { buildWorld, pathPointAt } from './world.js?v=9';
import { RaceManager, nearestParam } from './race.js?v=9';
import { Bots } from './ai.js?v=9';
import { Traffic } from './traffic.js?v=9';
import { Hud } from './hud.js?v=9';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const yawOf = (car) => Math.atan2(-car.fwd.x, -car.fwd.z);

export class HostGame {
  constructor(app, opts) {
    const { RAPIER, defId, name, net } = opts;
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
      onWreck: (car) => {
        const rz = car.racing;
        if (rz?.mode === 'race' && rz.race) {
          const p = rz.race.parts.get(car);
          if (p && !p.finished) {
            car.rescueData = { zone: rz, travel: Math.max(0, p.travel - 80), param: p.lastParam - 80 };
          }
        }
        if (car.racing) {
          // Utslagen mitt i loppet — tacklaren får äran
          const av = car.lastHitBy && !car.lastHitBy.disposed ? car.lastHitBy : null;
          if (av) av.score += 25;
          this.notifyAll('toast', '💥 ' + car.name + ' UTSLAGEN' + (av ? ' av ' + av.name : '') + '!');
          this.notify(car, 'announce', '💥 UTSLAGEN!');
          if (av) this.notify(av, 'toast', 'Du slog ut ' + car.name + '! +25 skrotpoäng');
        } else {
          this.notify(car, 'announce', '💀 DIN BIL SKROTADES!');
        }
      },
      onBoom: (car) => this.net?.broadcast({ t: 'boom', id: car.id }),
      onSpawnCar: (car) => this.broadcastSpawn(car),
      onDespawnCar: (car) => this.net?.broadcast({ t: 'despawn', id: car.id }),
    };

    this.worldApi = buildWorld(this.ctx);
    const rmCtx = {
      allCars: this.ctx.allCars,
      notify: (car, kind, text) => this.notify(car, kind, text),
      notifyAll: (kind, text, snd) => this.notifyAll(kind, text, snd),
      fillBots: (zone, n) => this.bots.fillRace(zone, n),
      applyVariant: () => this.applyVotedVariant(),
    };
    this.raceMgr = new RaceManager(rmCtx, this.worldApi.zones);
    this.ctx.raceMgr = this.raceMgr;

    this.bots = new Bots(this.ctx, this.worldApi, this.raceMgr, opts.aiNiva || 'blandat');
    this.bots.spawnAll(CONF.BOTS);
    this.traffic = new Traffic(this.ctx, this.worldApi);
    this.trainT = 50; // första tåget kommer efter ~30 s
    this.votes = new Map();
    this._voteCounts = [0, 0, 0];
    this.app.hud.onVote = (i) => this.castVote('local', i);

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
    if (car.wrecked || car.disposed || defId < 0 || defId >= CONF.VALBARA) return car;
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
        if ((msg.proto | 0) !== PROTO) { this.net.sendTo(id, { t: 'gammal' }); break; }
        const defId = clamp(msg.defId | 0, 0, CONF.VALBARA - 1);
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
          rp.car.input.hop = !!msg.j;
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
      case 'rosta': {
        if (this.remotePlayers.has(id)) this.castVote(id, msg.v | 0);
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
        st ? (st.mode === 'race' ? [1, Math.round(st.dist / 100), Math.round(st.total / 100), st.place, st.n] : [2, st.kvar, Math.round(st.t)]) : 0,
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
      rt: this.worldApi.zones.map(z => z.race ? Math.round(z.race.t) : 0),
      tz: r1(this.worldApi.train.z),
      vv: this.worldApi.activeVariantIdx,
      cars, props,
    };
  }

  // Sida-mot-sida: när bilar ligger jämsides släpper offrets däckgrepp delvis
  // så att man kan PUSHA motståndare i sidled och snurra dem (PIT-manöver!)
  markSidePress() {
    const cars = this.ctx.allCars;
    for (const c of cars) c.sidePress = false;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.disposed) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.disposed) continue;
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz > 40 || Math.abs(dy) > 2.5) continue;
        const alongA = dx * a.fwd.x + dz * a.fwd.z;
        const latA = dx * a.right.x + dz * a.right.z;
        if (Math.abs(alongA) < a.def.dims.l * 0.62 &&
            Math.abs(latA) < (a.def.dims.w + b.def.dims.w) / 2 + 0.55) {
          a.sidePress = true;
          b.sidePress = true;
        }
      }
    }
  }

  // ---------- Fysik ----------
  fixedStep(dt) {
    this.markSidePress();
    for (const c of this.ctx.allCars) c.physicsStep(dt);
    this.raceMgr.stepGates(dt);
    this.stepTrain(dt);
    this.ctx.world.step();
    this.damageScan();
  }

  // Banröstning (7/8/9 eller klick) — vinnaren appliceras vid racestart
  castVote(who, v) {
    if (v < 0 || v > 2) return;
    this.votes.set(who, v);
    const counts = [0, 0, 0];
    for (const x of this.votes.values()) counts[x]++;
    this._voteCounts = counts;
    this.net?.broadcast({ t: 'votestat', counts });
  }

  applyVotedVariant() {
    const c = this._voteCounts;
    let best = 0;
    for (let i = 1; i < c.length; i++) if (c[i] > c[best]) best = i;
    if (c[best] > 0 && best !== this.worldApi.activeVariantIdx) {
      this.worldApi.setVariant(best);
      this.net?.broadcast({ t: 'variant', v: best });
    }
    if (c[best] > 0) {
      this.notifyAll('toast', '🗳 Banröstningen: ' + this.worldApi.variant.namn + ' (' + c[best] + ' röster)!');
    }
    this.votes.clear();
    this._voteCounts = [0, 0, 0];
    this.net?.broadcast({ t: 'votestat', counts: this._voteCounts });
  }

  // Tåget: korsar båda rakorna (47 s färd, ~30 m/s), period per banvariant
  stepTrain(dt) {
    this.trainT += dt;
    const period = this.worldApi.variant?.tagPeriod ?? 80, travel = 47;
    const ph = this.trainT % period;
    const t = this.worldApi.train;
    if (ph < travel) t.setZ(-700 + (ph / travel) * 1400);
    else if (t.z < 2000) t.setZ(2500);
  }

  handleBoosts(dt) {
    for (const c of this.ctx.allCars) {
      if (c.boostCd > 0) { c.boostCd -= dt; continue; }
      if (c.wrecked || c.disposed || c.isTraffic) continue;
      for (const pad of this.worldApi.boostPads) {
        if (Math.abs(c.pos.x - pad.x) < pad.hl && Math.abs(c.pos.z - pad.z) < pad.hw && c.grounded) {
          c.boostCd = 2;
          const m = c.def.mass * 6;
          c.body.applyImpulse({ x: c.fwd.x * m, y: 0, z: c.fwd.z * m }, true);
          this.ctx.particles.sparks(c.pos, 22, 0x54ff9a, 10);
          if (c.owner === 'local') this.app.audio.boost();
          this.net?.broadcast({ t: 'fx', k: 'boost', id: c.id, x: r1(c.pos.x), y: r1(c.pos.y), z: r1(c.pos.z) });
          break;
        }
      }
    }
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

      // Tacklingar bil-mot-bil ska slå ut folk — väggar straffar lite mildare
      const mult = attacker ? CONF.DMG_CAR_MULT : CONF.DMG_WALL_MULT;
      const dmg = Math.min(CONF.DMG_MAX, (dv - CONF.DV_MIN) * CONF.DV_SCALE * mult);
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
        if (attacker && dv > 9) {
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
      if (!car.wrecked || car.deadT < 2.2) return car;
      const { id, owner, name, defId } = car;
      const rd = car.rescueData;
      car.dispose();
      let nc;
      if (rd && rd.zone.race) {
        // Lätt att komma tillbaka: ny bil 80 m bakåt PÅ banan, kvar i loppet
        const o = {};
        pathPointAt(rd.zone, Math.max(0, rd.param), o);
        nc = new Car(this.ctx, CARS[defId], new THREE.Vector3(o.x, spawnY(CARS[defId]), o.z),
          Math.atan2(-o.tx, -o.tz), { id, owner, name, defId });
        this.broadcastSpawn(nc);
        this.raceMgr.enroll(rd.zone, nc, false, rd.travel);
        this.notify(nc, 'announce', '🔧 NY BIL — JAGA IKAPP!');
      } else {
        nc = this.spawnFor(owner, name, defId, Math.floor(Math.random() * 10), id);
        this.notify(nc, 'toast', 'Ny bil framkörd i depån!');
      }
      assign(nc);
      return nc;
    };
    respawn(this.player, (nc) => { this.player = nc; });
    for (const rp of this.remotePlayers.values()) {
      respawn(rp.car, (nc) => { rp.car = nc; });
    }
  }

  // Efter målgång 13 km bort: skjutsa hem bilen till depån
  handleReturnHome(dt) {
    for (const c of this.ctx.allCars) {
      if (!c.returnHome || c.returnHome <= 0) continue;
      c.returnHome -= dt;
      if (c.returnHome <= 0 && !c.wrecked && !c.disposed && !c.racing) {
        const sp = this.worldApi.lobby.spawn(Math.floor(Math.random() * 12));
        c.resetTo(new THREE.Vector3(sp.pos.x, 2.2, sp.pos.z), sp.heading);
        if (c.owner !== null) this.notify(c, 'toast', 'Tillbaka i depån — bra kört!');
      }
    }
  }

  // Banvakten: den som hamnar utanför banan lyfts in igen efter 4 s.
  // Man ska ALLTID kunna komma tillbaka. (Navet vid depån är undantaget.)
  handleOffTrack(dt) {
    this._offT = (this._offT || 0) + dt;
    if (this._offT < 0.25) return;
    const step = this._offT;
    this._offT = 0;
    const z = this.worldApi.zones[0];
    for (const c of this.ctx.allCars) {
      if (c.disposed || c.wrecked || c.isTraffic) continue;
      if (c.pos.x > CONF.STAGE_X - 140) { c.offTrackT = 0; continue; }
      const np = nearestParam(z, c.pos, -1);
      if (np.dist > z.width / 2 + 2) {
        c.offTrackT = (c.offTrackT || 0) + step;
        if (c.offTrackT > 4) {
          c.offTrackT = 0;
          const o = {};
          pathPointAt(z, np.param, o);
          c.resetTo(new THREE.Vector3(o.x, 1.6, o.z), Math.atan2(-o.tx, -o.tz));
          if (c.owner !== null) this.notify(c, 'announce', '🚧 TILLBAKA PÅ BANAN!');
        }
      } else c.offTrackT = 0;
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
    if (input.take('KeyN')) hud.toast(audio.toggleMusic() ? 'Musik på 🎵' : 'Musik av');
    for (let i = 0; i < CONF.VALBARA; i++) {
      if (input.take('Digit' + (i + 1))) this.trySwap(this.player, i);
    }
    for (let i = 0; i < 3; i++) {
      if (input.take('Digit' + (i + 7))) this.castVote('local', i);
    }

    this.acc += Math.min(dt, 0.06);
    while (this.acc >= CONF.DT) {
      this.fixedStep(CONF.DT);
      this.acc -= CONF.DT;
      this.simT += CONF.DT;
    }

    this.bots.update(dt);
    this.traffic.update(dt);
    this.raceMgr.update(dt);
    this.handleBoosts(dt);
    this.handleWipeouts();
    this.handleRespawns();
    this.handlePads(dt);
    this.handleOffTrack(dt);
    this.handleReturnHome(dt);

    // Varning: 15 s kvar och du står inte i någon fålla
    const tl = this.raceMgr.tLeft;
    if ((this._prevTL ?? 60) > 15 && tl <= 15) {
      const inS = (c, s) => c.pos.x > s.x0 && c.pos.x < s.x1 && c.pos.z > s.z0 && c.pos.z < s.z1;
      const zs = this.worldApi.zones;
      for (const c of [this.player, ...[...this.remotePlayers.values()].map(r => r.car)]) {
        if (c.racing || c.wrecked || c.disposed) continue;
        if (!inS(c, zs[0].staging) && !inS(c, zs[1].staging)) {
          this.notify(c, 'toast', '⏱ 15 s till start — följ pilarna till STARTFÅLLAN!');
        }
      }
    }
    this._prevTL = tl;

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
    audio.setEngine(Math.min(1, Math.abs(p.speed) / 50), p.input.throttle, p.def.motor);
    if (kmh < 4 && p.input.throttle > 0.5 && !p.wrecked && (this._launchCd ?? 0) <= 0) {
      audio.launch(p.def.motor);
      this._launchCd = 3;
    }
    if ((this._launchCd ?? 0) > 0) this._launchCd -= dt;
    hud.update({
      kmh,
      health01: p.health / p.maxHealth,
      carName: p.def.namn + (p.turboT > 0 ? ' ⚡' : ''),
      score: p.score,
      raceText: Hud.raceText(this.raceMgr.getStatus(p), this.raceMgr.tLeft),
    });

    // Live-resultattavla + positionsbar + röstpanel
    const rz = this.worldApi.zones[0];
    if (rz.race) {
      const rows = [...rz.race.parts.entries()]
        .map(([c, q]) => ({
          name: c.name || '—', place: q.finished ? q.place : (q.place || 99),
          dist: Math.max(0, q.travel), fin: q.finished,
          me: c === this.player, color: c.def.color,
        }))
        .sort((a, b) => a.place - b.place);
      hud.board(rows, rz.race.t, rz.raceDist);
      hud.progress(rows, rz.raceDist);
    } else {
      hud.board(null);
      hud.progress(null);
    }
    hud.votePanel(!rz.race && this.raceMgr.tLeft <= 30, this._voteCounts, this.votes.get('local'));

    if (this.net) {
      this.snapT += dt;
      if (this.snapT > 1 / 15) {
        this.snapT = 0;
        this.net.broadcast(this.snapshot());
      }
    }
  }
}
