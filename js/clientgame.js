// Gästens spelloop: ren visning. Tar emot snapshots/händelser från värden,
// interpolerar bilarna, gör lokal ballistik för delar som flyger av,
// och skickar sin input till värden.
import * as THREE from 'three';
import { CONF, CARS, PROTO } from './config.js?v=11';
import { buildWorld, stepGates } from './world.js?v=11';
import { CarView } from './carview.js?v=11';
import { Hud } from './hud.js?v=11';

const _v = new THREE.Vector3();

export class ClientGame {
  constructor(app, { net, name, defId, publicMode = false }) {
    this.publicMode = publicMode;
    this.app = app;
    this.net = net;
    this.ctx = { scene: app.scene, world: null, RAPIER: null, noDmg: new Set() };
    this.worldApi = buildWorld(this.ctx);
    this.views = new Map();
    this.myId = -1;
    this.loose = [];
    this.tLeft = 60;
    this.zr = [0, 0];
    this.inputT = 0;
    this.timeOffset = null;
    this.simT = 0;
    this.connected = true;

    net.handlers.onData = (msg) => this.onData(msg);
    net.handlers.onClose = () => {
      this.connected = false;
      if (this.publicMode) {
        // Värden försvann — ladda om så tar någon (kanske du) över värdskapet
        this.app.hud.announce('Värden försvann — startar om …');
        try { sessionStorage.setItem('skrotderby_auto', '1'); } catch { /* ok */ }
        setTimeout(() => window.location.reload(), 2500);
      } else {
        this.app.hud.announce('Tappade kontakten med värden 😢');
      }
    };
    net.send({ t: 'hej', name, defId, proto: PROTO });
    this._hejT = 9; // vakthund: får vi inget välkommen är värden trasig/gammal
  }

  ensureView(id, defId, name, replace = false) {
    const old = this.views.get(id);
    if (old) {
      if (!replace) return old;
      old.dispose();
      this.views.delete(id);
    }
    const v = new CarView(this.app.scene, id, defId, name, id === this.myId);
    this.views.set(id, v);
    return v;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (v) { v.dispose(); this.views.delete(id); }
  }

  myView() { return this.views.get(this.myId); }

  onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'gammal': {
        this.app.hud.announce('Värden kör en annan version — ladda om! (Ctrl+Shift+R)');
        this.connected = false;
        break;
      }
      case 'valkommen': {
        this._hejT = 0;
        this.myId = msg.dinBil;
        for (const c of msg.cars) this.ensureView(c.id, c.defId, c.name);
        // egen vy kan ha skapats innan vi visste vårt id — bygg om utan namnskylt
        const me = this.views.get(this.myId);
        if (me?.label) this.ensureView(this.myId, me.defId, me.name, true);
        break;
      }
      case 'spawn':
        this.ensureView(msg.id, msg.defId, msg.name, true);
        break;
      case 'despawn':
        this.removeView(msg.id);
        break;
      case 'snap':
        this.onSnap(msg);
        break;
      case 'los': {
        const v = this.views.get(msg.id);
        if (!v) break;
        const freed = v.detachNamed(msg.part);
        if (freed) {
          this.loose.push({
            mesh: freed.mesh,
            vel: new THREE.Vector3(msg.vx, msg.vy, msg.vz),
            angv: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
            groundY: Math.max(freed.size.x, freed.size.y, freed.size.z) * 0.3 + 0.05,
            life: CONF.LOOSE_LIFE,
          });
          _v.set(msg.x, msg.y, msg.z);
          this.app.particles.sparks(_v, 10, 0xffb347, 7);
        }
        break;
      }
      case 'dmg': {
        _v.set(msg.x, msg.y, msg.z);
        this.app.particles.sparks(_v, 4 + msg.i, 0xffb347, 7);
        const me = this.myView();
        const d = me ? Math.hypot(msg.x - me.pos.x, msg.z - me.pos.z) : 60;
        this.app.audio.crash(Math.min(1, msg.i / 22) * Math.max(0.15, 1 - d / 120));
        break;
      }
      case 'boom': {
        const v = this.views.get(msg.id);
        if (v) {
          this.app.particles.sparks(v.pos, 60, 0xffaa33, 14);
          this.app.audio.boom(msg.id === this.myId ? 1 : 0.5);
        }
        break;
      }
      case 'fx': {
        if (msg.k === 'boost') {
          _v.set(msg.x, msg.y ?? 0.5, msg.z);
          this.app.particles.sparks(_v, 22, 0x54ff9a, 10);
          if (msg.id === this.myId) this.app.audio.boost();
        }
        break;
      }
      case 'votestat':
        this.voteCounts = msg.counts || [0, 0, 0];
        break;
      case 'variant':
        this.worldApi.setVariant(msg.v | 0);
        this.myVote = undefined;
        break;
      case 'msg': {
        if (msg.kind === 'toast') this.app.hud.toast(msg.text);
        else this.app.hud.announce(msg.text);
        if (msg.snd === 'start') this.app.audio.raceStart();
        if (msg.snd === 'win') this.app.audio.win();
        break;
      }
    }
  }

  onSnap(msg) {
    const now = performance.now() / 1000;
    const off = msg.time - now;
    this.timeOffset = this.timeOffset == null ? off : this.timeOffset + (off - this.timeOffset) * 0.08;
    this.tLeft = msg.tLeft;
    this.zr = msg.zr;
    this.raceT = msg.rt?.[0] ?? 0;
    this.trainTarget = msg.tz ?? -2500;
    if (msg.vv != null && msg.vv !== this.worldApi.activeVariantIdx) this.worldApi.setVariant(msg.vv);
    for (const row of msg.cars) {
      const v = this.views.get(row[0]);
      if (v) v.pushState(msg.time, row);
    }
    if (msg.props) {
      for (const pr of msg.props) {
        const p = this.worldApi.props[pr[0]];
        if (p) {
          p.mesh.position.set(pr[1], pr[2], pr[3]);
          p.mesh.quaternion.set(pr[4], pr[5], pr[6], pr[7]);
        }
      }
    }
  }

  statusOf(v) {
    const s = v?.status;
    if (!s || !Array.isArray(s)) return null;
    if (s[0] === 1) return { mode: 'race', dist: s[1] * 100, total: s[2] * 100, place: s[3], n: s[4] };
    return { mode: 'derby', kvar: s[1], t: s[2] };
  }

  updateLoose(dt) {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const e = this.loose[i];
      e.life -= dt;
      if (e.life <= 0) {
        e.mesh.parent?.remove(e.mesh);
        this.loose.splice(i, 1);
        continue;
      }
      e.vel.y -= CONF.GRAV * dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.rotation.x += e.angv.x * dt;
      e.mesh.rotation.y += e.angv.y * dt;
      e.mesh.rotation.z += e.angv.z * dt;
      if (e.mesh.position.y < e.groundY) {
        e.mesh.position.y = e.groundY;
        e.vel.y = Math.abs(e.vel.y) * 0.35;
        e.vel.x *= 0.7; e.vel.z *= 0.7;
        e.angv.multiplyScalar(0.6);
        if (e.vel.y < 0.6) e.vel.y = 0;
      }
      if (e.life < 1) e.mesh.scale.setScalar(Math.max(0.01, e.life));
    }
  }

  update(dt) {
    const { input, hud, audio, cam, sun } = this.app;
    this.simT += dt;

    // Vakthund: värden svarade aldrig på hej → starta om (nästa försök kan bli värd)
    if (this._hejT > 0 && this.myId < 0) {
      this._hejT -= dt;
      if (this._hejT <= 0) {
        if (this.publicMode) {
          hud.announce('Värden svarar inte — startar om …');
          try { sessionStorage.setItem('skrotderby_auto', '1'); } catch { /* ok */ }
          setTimeout(() => window.location.reload(), 2000);
        } else {
          hud.announce('Värden svarar inte 😢 — ladda om och försök igen');
        }
      }
    }
    const renderT = (performance.now() / 1000) + (this.timeOffset ?? 0) - 0.13;

    for (const v of this.views.values()) v.update(dt, renderT, this.app.particles);

    this.worldApi.zones.forEach((z, i) => {
      z.gatesOpen = ((this.zr[i] || 0) & 2) !== 0;
      stepGates(z, dt);
    });
    this.worldApi.updateBoards(this.tLeft, !!(this.zr[0] & 1), !!(this.zr[1] & 1));
    this.worldApi.updateVisuals(dt, this.simT);
    this.updateLoose(dt);
    this.app.particles.update(dt);

    // Input till värden
    const inp = input.playerInput();
    this.inputT += dt;
    if (this.inputT > 1 / 30) {
      this.inputT = 0;
      if (this.connected) this.net.send({ t: 'input', g: inp.throttle, s: inp.steer, h: inp.handbrake ? 1 : 0, j: inp.hop ? 1 : 0 });
    }
    if (input.take('KeyR')) this.net.send({ t: 'reset' });
    if (input.take('KeyX')) this.net.send({ t: 'sprang' });
    if (input.take('KeyC')) cam.toggle();
    if (input.take('KeyM')) hud.toast(audio.toggleMute() ? 'Ljud av 🔇' : 'Ljud på 🔊');
    if (input.take('KeyN')) hud.toast(audio.toggleMusic() ? 'Musik på 🎵' : 'Musik av');
    for (let i = 0; i < CONF.VALBARA; i++) {
      if (input.take('Digit' + (i + 1))) this.net.send({ t: 'byt', defId: i });
    }
    for (let i = 0; i < 3; i++) {
      if (input.take('Digit' + (i + 7))) { this.myVote = i; this.net.send({ t: 'rosta', v: i }); }
    }
    if (!this._voteHook) {
      this._voteHook = true;
      hud.onVote = (i) => { this.myVote = i; this.net.send({ t: 'rosta', v: i }); };
    }

    // Tåget rullar mjukt mot senaste synkade positionen
    if (this.trainTarget != null) {
      const tr = this.worldApi.train;
      tr.setZ(tr.z + (this.trainTarget - tr.z) * Math.min(1, 8 * dt));
    }
    if (this.zr[0] & 1) this.raceT += dt;

    const me = this.myView();
    if (me && me.group.visible) {
      // Byt-plattor: lokal detektering, värden validerar
      let onPad = null;
      for (const pad of this.worldApi.lobby.pads) {
        if (Math.hypot(me.pos.x - pad.pos.x, me.pos.z - pad.pos.z) < 2.7 && me.kmh < 13) { onPad = pad; break; }
      }
      if (onPad && onPad.defId !== me.defId) {
        this._padT = (this._padT || 0) + dt;
        if (this._padT > 1.1) { this._padT = 0; this.net.send({ t: 'byt', defId: onPad.defId }); }
      } else this._padT = 0;

      cam.update(dt, me.pos, me.fwd, me.kmh);
      sun.position.set(me.pos.x + 80, 120, me.pos.z + 40);
      sun.target.position.set(me.pos.x, 0, me.pos.z);
      sun.target.updateMatrixWorld();
      audio.setEngine(Math.min(1, (me.kmh / 3.6) / 50), inp.throttle, CARS[me.defId]?.motor);
      if (me.kmh < 4 && inp.throttle > 0.5 && !me.wrecked && (this._launchCd ?? 0) <= 0) {
        audio.launch(CARS[me.defId]?.motor);
        this._launchCd = 3;
      }
      if ((this._launchCd ?? 0) > 0) this._launchCd -= dt;
      hud.update({
        kmh: me.kmh,
        health01: me.health01,
        carName: (CARS[me.defId]?.namn || '') + (me.turbo ? ' ⚡' : ''),
        score: me.score,
        raceText: Hud.raceText(this.statusOf(me), this.tLeft),
      });
    }

    // Live-resultattavla + positionsbar + röstpanel
    if (this.zr[0] & 1) {
      let total = 13000;
      const rows = [];
      for (const v of this.views.values()) {
        const s = v.status;
        if (Array.isArray(s) && s[0] === 1) {
          total = s[2] * 100 || total;
          rows.push({ name: v.name || '—', place: s[3] || 99, dist: s[1] * 100, me: v.id === this.myId, color: CARS[v.defId]?.color ?? 0xffffff });
        }
      }
      rows.sort((a, b) => a.place - b.place);
      hud.board(rows, this.raceT, total);
      hud.progress(rows.map(r => ({ ...r, dist: r.dist })), total);
    } else {
      hud.board(null);
      hud.progress(null);
    }
    hud.votePanel(!(this.zr[0] & 1) && this.tLeft <= 30, this.voteCounts || [0, 0, 0], this.myVote);
  }
}
