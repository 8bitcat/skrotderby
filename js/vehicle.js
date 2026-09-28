// Fysikbil (körs bara på värden). Custom raycast-fjädring + däckkrafter ovanpå Rapier,
// så att enskilda hjul kan slitas loss och bilen ändå fortsätter gå att köra.
import * as THREE from 'three';
import { CONF } from './config.js?v=19';
import { buildCarVisual, buildWheelMesh, wheelAnchors, makeNameSprite } from './carstyles.js?v=19';
import { pathPointAt } from './world.js?v=19';

// ---------- Säkra platser: ingen ska spawna/lyftas ovanpå en annan bil ----------
export function spotFree(cars, x, z, r = 5.5, except = null) {
  for (const c of cars) {
    if (c === except || c.disposed) continue;
    const dx = c.pos.x - x, dz = c.pos.z - z;
    if (dx * dx + dz * dz < r * r && Math.abs(c.pos.y - 1) < 8) return false;
  }
  return true;
}

// Närmaste lediga punkt längs banan kring param (prövar filer + små förskjutningar)
export function freeTrackSpot(zone, param, cars, except = null) {
  const o = {};
  for (const dp of [0, -18, 18, -36, 36, -60, 60, -90]) {
    pathPointAt(zone, param + dp, o);
    for (const lane of [0, -7, 7, -13, 13, -3.5, 3.5]) {
      const x = o.x - o.tz * lane, z = o.z + o.tx * lane;
      if (spotFree(cars, x, z, 5.5, except)) return { x, z, heading: Math.atan2(-o.tx, -o.tz), dp };
    }
  }
  pathPointAt(zone, param, o);
  return { x: o.x, z: o.z, heading: Math.atan2(-o.tx, -o.tz), dp: 0 };
}

// Ledig ruta i lobbyn
export function freeLobbySpawn(lobby, cars, start = 0) {
  for (let k = 0; k < 24; k++) {
    const sp = lobby.spawn(start + k);
    if (spotFree(cars, sp.pos.x, sp.pos.z, 5)) return sp;
  }
  return lobby.spawn(start);
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(),
      _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

let seq = 0;

export function spawnY(def) {
  return def.wheelR + (def.susRest || 0.42) + def.dims.h * 0.5 + 0.2;
}

export class Car {
  constructor(ctx, def, pos, heading, opts = {}) {
    this.ctx = ctx;
    this.def = def;
    this.defId = opts.defId ?? 0;
    this.id = opts.id ?? ++seq;
    this.owner = opts.owner ?? null;        // null=bot, 'local'=värdens spelare, annars nät-id
    this.isPlayer = this.owner === 'local';
    this.name = opts.name || def.namn;

    this.health = def.health * CONF.HALSA_MULT; this.maxHealth = this.health;
    this.wrecked = false; this.deadT = 0; this.exploded = false; this.respawnAfter = 4;
    this.speedMult = 1; this.turboT = 0; this.flipT = 0; this.dmgCooldown = 0;
    this.score = 0; this.racing = null; this.raceCooldown = 0; this.disposed = false;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.steerCur = 0; this.speed = 0; this.absSpeed = 0; this.grounded = false;
    this._smokeAcc = 0;

    this.pos = new THREE.Vector3().copy(pos);
    this.quat = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    this.vel = new THREE.Vector3(); this.angv = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.comOffset = new THREE.Vector3(0, -def.dims.h * 0.3, 0);
    this._wf = new THREE.Vector3(); this._wr = new THREE.Vector3(); this._vc = new THREE.Vector3();

    this._buildBody();
    this._buildWheels();
    this._buildVisual();
    ctx.allCars.push(this);
  }

  _buildBody() {
    const { RAPIER, world } = this.ctx;
    const { l, w, h } = this.def.dims;
    const rbd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.pos.x, this.pos.y, this.pos.z)
      .setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w })
      .setCanSleep(false).setAngularDamping(1.05).setLinearDamping(0.06);
    this.body = world.createRigidBody(rbd);
    const cd = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, l / 2)
      .setTranslation(0, -h * 0.3, 0)
      .setMass(this.def.mass)
      .setFriction(0.35).setRestitution(0.3);
    this.collider = world.createCollider(cd, this.body);
    this.ctx.carsByCollider.set(this.collider.handle, this);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  _buildWheels() {
    const def = this.def;
    const k = def.mass * 26, c = def.mass * 3.2;
    this.wheels = wheelAnchors(def).map((a, i) => {
      const vis = buildWheelMesh(def, i);
      return {
        anchorL: new THREE.Vector3(a.x, a.y, a.z), steered: a.steered, powered: a.powered,
        radius: def.wheelR, susRest: def.susRest || 0.42, k, c,
        health: 30 * (def.health / 100) * CONF.HJUL_MULT, detached: false, grounded: false,
        load: 0, visLen: (def.susRest || 0.42) + def.wheelR, spin: 0,
        holder: vis.holder, spinMesh: vis.spin,
      };
    });
  }

  _buildVisual() {
    const built = buildCarVisual(this.def);
    this.group = built.group;
    this.parts = built.parts;
    this.bodyMeshes = built.bodyMeshes;
    for (const w of this.wheels) {
      w.holder.position.copy(w.anchorL);
      this.group.add(w.holder);
    }
    if (!this.isPlayer) {
      this.label = makeNameSprite(this.name);
      this.label.position.set(0, this.def.dims.h + 0.9, 0);
      this.group.add(this.label);
    }
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    this.ctx.scene.add(this.group);
  }

  velAt(p, out) {
    _e.copy(this.comOffset).applyQuaternion(this.quat).add(this.pos);
    out.copy(p).sub(_e);
    out.crossVectors(this.angv, out);
    return out.add(this.vel);
  }

  physicsStep(dt) {
    const rb = this.body, def = this.def;
    const t = rb.translation(); this.pos.set(t.x, t.y, t.z);
    const r = rb.rotation(); this.quat.set(r.x, r.y, r.z, r.w);
    const lv = rb.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    const av = rb.angvel(); this.angv.set(av.x, av.y, av.z);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    const vFwd = this.vel.dot(this.fwd);
    this.speed = vFwd; this.absSpeed = this.vel.length();
    if (this.dmgCooldown > 0) this.dmgCooldown -= dt;
    if (this.turboT > 0) this.turboT -= dt;
    if (this.raceCooldown > 0) this.raceCooldown -= dt;
    if (this.hopCd > 0) this.hopCd -= dt;

    // Ramlade ur världen?
    if (this.pos.y < -25) this.resetTo(new THREE.Vector3(CONF.LOBBY.x, 3, CONF.LOBBY.z + 40), 0);

    if (this.wrecked) return;

    this.flipT = this.up.y < 0.25 ? this.flipT + dt : 0;
    // friare rotation när någon trycker på sidan — spin-outs ska hända
    rb.setAngularDamping(this.sidePress ? 0.45 : 0.8);

    // Styrning (mindre utslag i hög fart, men nog för att kontra i sladd)
    const steerMax = def.steerMax / (1 + Math.abs(vFwd) * 0.055);
    const targetSteer = this.input.steer * steerMax;
    this.steerCur += (targetSteer - this.steerCur) * Math.min(1, 9 * dt);

    // Motor och broms — skadad motor orkar mindre
    const hf = 0.6 + 0.4 * Math.max(0, this.health) / this.maxHealth;
    const mult = this.speedMult * (this.turboT > 0 ? 1 + CONF.COMEBACK_TURBO : 1);
    const vmax = (this.raceVmax ?? def.maxKmh / 3.6) * mult; // fartstegen i race
    let drive = 0, brake = 0;
    const th = this.input.throttle;
    if (th > 0.01) {
      if (vFwd < vmax) drive = th * def.power * CONF.POWER_MULT * (this.racePower ?? 1) * mult * hf;
    } else if (th < -0.01) {
      if (vFwd > 1.5) brake = def.power * 1.5 * (-th);
      else if (vFwd > -11) drive = th * def.power * 0.55 * hf;
    }
    const nPow = this.wheels.filter(w => w.powered && !w.detached).length || 1;

    let grounded = 0;
    for (const w of this.wheels) {
      if (w.detached) continue;
      _a.copy(w.anchorL).applyQuaternion(this.quat).add(this.pos);
      _b.copy(this.up).negate();
      const maxToi = w.susRest + w.radius + (w.broken ? Math.sin(w.spin) * 0.05 : 0);
      this.ray.origin.x = _a.x; this.ray.origin.y = _a.y; this.ray.origin.z = _a.z;
      this.ray.dir.x = _b.x; this.ray.dir.y = _b.y; this.ray.dir.z = _b.z;
      const hit = this.ctx.world.castRay(this.ray, maxToi, true, undefined, undefined, undefined, rb);
      if (!hit) {
        w.grounded = false; w.load = 0;
        w.visLen += (maxToi - w.visLen) * Math.min(1, 8 * dt);
        continue;
      }
      const len = (hit.toi !== undefined) ? hit.toi : hit.timeOfImpact;
      grounded++; w.grounded = true; w.visLen = len;

      // Fjädring
      const comp = maxToi - len;
      const vAt = this.velAt(_a, _c);
      const vDown = vAt.dot(_b);
      let F = w.k * comp + w.c * vDown;
      F = Math.max(0, Math.min(F, def.mass * CONF.GRAV * 0.9));
      w.load = F;
      _d.copy(_b).multiplyScalar(-F * dt);
      rb.applyImpulseAtPoint({ x: _d.x, y: _d.y, z: _d.z }, { x: _a.x, y: _a.y, z: _a.z }, true);

      // Däckkrafter i kontaktpunkten
      _c.copy(_b).multiplyScalar(len).add(_a); // kontaktpunkt
      this._wf.copy(this.fwd); this._wr.copy(this.right);
      if (w.steered && Math.abs(this.steerCur) > 0.001) {
        this._wf.applyAxisAngle(this.up, this.steerCur);
        this._wr.applyAxisAngle(this.up, this.steerCur);
      }
      const vC = this.velAt(_c, this._vc);
      const vF2 = vC.dot(this._wf);
      const vS = vC.dot(this._wr);

      let longImp = 0;
      if (drive && w.powered) longImp += (drive / nPow) * dt;
      if (brake) longImp += -Math.sign(vF2) * Math.min((brake / 4) * dt, Math.abs(vF2) * def.mass / 4);
      const capL = def.grip * 1.15 * F * dt * 1.4 * (w.broken ? 0.6 : 1);
      longImp = Math.max(-capL, Math.min(capL, longImp));

      // Lösare bakvagn → bilen driftar istället för att bita fast och välta
      const isRear = w.anchorL.z > 0;
      // Bakvagnen greppar lite MER än fronten ⇒ stabil bil som svänger dit man styr;
      // vill man sladda drar man handbromsen
      let muS = (this.input.handbrake && isRear) ? def.grip * 0.3 : def.grip * (isRear ? 1.1 : 1.0);
      if (this.sidePress) muS *= 0.48; // jämsides: man KAN pushas i sidled och snurras
      if (w.broken) muS *= 0.55;       // trasigt framhjul: bilen drar åt det hållet
      let latImp = -vS * def.mass / 4;
      const capS = muS * F * dt;
      latImp = Math.max(-capS, Math.min(capS, latImp));

      // Längskraft i kontaktpunkten — men SIDOKRAFT i tyngdpunktshöjd,
      // så kurvtagning inte skapar vältmoment. Drift, inte volt!
      // Drivkraft/broms OCKSÅ i tyngdpunktshöjd: annars lyfter gaspådrag fronten
      // (ingen last = inget grepp) och bilen går inte att svänga med gasen i botten
      _e.copy(this.comOffset).applyQuaternion(this.quat).add(this.pos);
      _d.copy(this._wf).multiplyScalar(longImp);
      rb.applyImpulseAtPoint({ x: _d.x, y: _d.y, z: _d.z }, { x: _c.x, y: _e.y, z: _c.z }, true);
      _d.copy(this._wr).multiplyScalar(latImp);
      rb.applyImpulseAtPoint({ x: _d.x, y: _d.y, z: _d.z }, { x: _c.x, y: _e.y, z: _c.z }, true);
      w.spin += vF2 / w.radius * dt;
    }
    this.grounded = grounded > 0;

    // Stabilitetshjälp: girhastigheten får inte skena förbi vad ratten ber om
    // (ingen okontrollerad snurr av gaspådrag) — tacklingar och handbroms undantagna
    if (this.grounded && !this.input.handbrake && !this.sidePress && this.absSpeed > 8) {
      const wb = Math.max(1.5, this.wheels[2].anchorL.z - this.wheels[0].anchorL.z);
      const want = (vFwd * Math.tan(this.steerCur)) / wb;          // kinematisk girhastighet
      const gripYaw = (def.grip * CONF.GRAV * 1.15) / Math.max(5, this.absSpeed); // vad däcken klarar
      const yaw = this.angv.dot(this.up);
      const lim = Math.min(Math.abs(want), gripYaw) + 0.12;
      if (Math.abs(yaw) > lim) {
        const excess = yaw - Math.sign(yaw) * lim;
        const I = def.mass * (def.dims.l * def.dims.l + def.dims.w * def.dims.w) / 12;
        const k = Math.min(1, 12 * dt) * excess * I;
        rb.applyTorqueImpulse({ x: -this.up.x * k, y: -this.up.y * k, z: -this.up.z * k }, true);
      }
    }
    // SHIFT = hopp — man ska alltid kunna hoppa
    if (this.input.hop && this.grounded && !(this.hopCd > 0)) {
      this.hopCd = 2.5;
      rb.applyImpulse({ x: this.up.x * def.mass * 7.3, y: this.up.y * def.mass * 7.3, z: this.up.z * def.mass * 7.3 }, true);
    }
  }

  applyDamage(amount, point, attacker) {
    if (this.wrecked || this.disposed || this.dmgCooldown > 0) return 0;
    this.dmgCooldown = CONF.DMG_COOLDOWN;
    amount = Math.min(CONF.DMG_MAX, amount);
    this.health -= amount * 0.55;
    if (attacker && !attacker.disposed) {
      attacker.score += Math.round(amount);
      this.lastHitBy = attacker;
    }

    // Vilka delar sitter närmast smällen?
    _q.copy(this.quat).invert();
    _a.set(point.x, point.y, point.z).sub(this.pos).applyQuaternion(_q);
    const cands = [];
    for (const p of this.parts) if (p.attached) cands.push({ p, d: _a.distanceTo(p.pos), wheel: false });
    this.wheels.forEach((w, i) => {
      if (!w.detached) cands.push({ w, i, d: _a.distanceTo(w.anchorL) * 1.3, wheel: true });
    });
    cands.sort((x, y) => x.d - y.d);
    const shares = [0.95, 0.5];
    for (let s = 0; s < 2 && s < cands.length; s++) {
      const c = cands[s], dmg = amount * shares[s];
      if (c.wheel) {
        c.w.health -= dmg;
        if (c.w.health <= 0) {
          if (c.w.steered) this.breakWheel(c.i); // framhjulen sitter kvar men går sönder
          else this.detachWheel(c.i);
        }
      } else {
        c.p.health -= dmg;
        if (c.p.health <= 0) this.detachPart(c.p);
        else if (!c.p.drooped && c.p.health < c.p.maxHealth * 0.55) {
          // Bucklig del som hänger snett
          c.p.drooped = true;
          c.p.mesh.rotation.x += (Math.random() - 0.5) * 0.24;
          c.p.mesh.rotation.z += (Math.random() - 0.5) * 0.2;
          c.p.mesh.position.y -= 0.03;
        }
      }
    }
    if (this.health <= 0) this.wreck();
    return amount;
  }

  _spawnLoose(obj3d, size, massGuess, extraUp = 0) {
    const { RAPIER, world, scene } = this.ctx;
    obj3d.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    obj3d.matrixWorld.decompose(wp, wq, ws);
    if (obj3d.parent) obj3d.parent.remove(obj3d);
    scene.add(obj3d);
    obj3d.position.copy(wp); obj3d.quaternion.copy(wq);
    const boost = 1 + extraUp * 0.15;
    const vx = this.vel.x + rnd(-3.5, 3.5) * boost;
    const vy = Math.max(1, this.vel.y) + rnd(3, 6.5) + extraUp;
    const vz = this.vel.z + rnd(-3.5, 3.5) * boost;
    const rbd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
      .setLinvel(vx, vy, vz)
      .setAngvel({ x: rnd(-6, 6), y: rnd(-6, 6), z: rnd(-6, 6) });
    const body = world.createRigidBody(rbd);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(0.05, size.x / 2 * 0.85), Math.max(0.05, size.y / 2 * 0.85), Math.max(0.05, size.z / 2 * 0.85))
        .setMass(massGuess).setFriction(0.6).setRestitution(0.35),
      body
    );
    this.ctx.addLoose({ mesh: obj3d, body, life: CONF.LOOSE_LIFE });
    return { pos: wp, vel: { x: vx, y: vy, z: vz } };
  }

  detachPart(p, extraUp = 0) {
    if (!p.attached) return;
    p.attached = false;
    const mass = Math.min(38, Math.max(6, p.size.x * p.size.y * p.size.z * 90));
    const info = this._spawnLoose(p.mesh, p.size, mass, extraUp);
    this.ctx.particles.sparks(info.pos, 16, 0xffc060, 8, { life: 0.6 });
    this.ctx.particles.smoke(info.pos, { color: 0x777777, size: 0.5, life: 0.5, vy: 1 });
    this.ctx.onDetach?.(this, p.name, info.pos, info.vel, p.size);
  }

  detachWheel(i, extraUp = 0) {
    const w = this.wheels[i];
    if (w.detached) return;
    w.detached = true;
    // Klotformad kollider — hjulet rullar/studsar iväg
    const { RAPIER, world, scene } = this.ctx;
    const obj3d = w.holder;
    obj3d.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    obj3d.matrixWorld.decompose(wp, wq, ws);
    if (obj3d.parent) obj3d.parent.remove(obj3d);
    scene.add(obj3d);
    obj3d.position.copy(wp); obj3d.quaternion.copy(wq);
    const rbd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
      .setLinvel(this.vel.x + rnd(-3, 3), Math.max(1, this.vel.y) + rnd(2, 5) + extraUp, this.vel.z + rnd(-3, 3))
      .setAngvel({ x: rnd(-8, 8), y: rnd(-4, 4), z: rnd(-8, 8) });
    const body = world.createRigidBody(rbd);
    world.createCollider(
      RAPIER.ColliderDesc.ball(w.radius * 0.9).setMass(16).setFriction(0.8).setRestitution(0.45),
      body
    );
    this.ctx.addLoose({ mesh: obj3d, body, life: CONF.LOOSE_LIFE });
    this.ctx.particles.sparks(wp, 18, 0xffc060, 9, { life: 0.6 });
    this.ctx.onDetach?.(this, 'hjul' + i, wp, body.linvel(), new THREE.Vector3(w.radius * 2, w.radius * 2, w.radius * 2));
  }

  wreck() {
    if (this.wrecked) return;
    this.wrecked = true;
    this.health = 0;
    this.deadT = 0;
    this.body.setAngularDamping(1.5);
    this.body.setLinearDamping(0.8);
    this.ctx.onWreck?.(this);
  }

  // Grafik + vrak-tidslinje (renderingstakt)
  update(dt) {
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    for (const w of this.wheels) {
      if (w.detached) continue;
      w.holder.position.set(w.anchorL.x, w.anchorL.y - (w.visLen - w.radius), w.anchorL.z);
      w.holder.rotation.y = w.steered ? this.steerCur : 0;
      w.spinMesh.rotation.x = -w.spin; // framåt = toppen rör sig mot −z
      if (w.broken) {
        // skevt, vobblande hjul — vobblet följer hjulets varv
        w.holder.rotation.z = Math.sin(w.spin) * 0.16;
        w.holder.rotation.y += Math.sin(w.spin * 0.5 + 1) * 0.1;
        if (w.grounded && this.absSpeed > 8 && Math.random() < dt * 14) {
          _a.copy(w.anchorL).applyQuaternion(this.quat).add(this.pos);
          _a.y -= w.visLen;
          this.ctx.particles.sparks(_a, 3, 0xffc070, 4);
        }
      } else w.holder.rotation.z = 0;
    }

    const frac = this.health / this.maxHealth;
    if (!this.wrecked && frac < 0.45) {
      this._smokeAcc += dt * (0.5 - frac) * 14;
      while (this._smokeAcc > 1) {
        this._smokeAcc -= 1;
        _a.set(0, this.def.dims.h * 0.3, -this.def.dims.l * 0.3).applyQuaternion(this.quat).add(this.pos);
        this.ctx.particles.smoke(_a, { color: 0x555555, size: 0.9, life: 1.4 });
      }
    }
    if (this.wrecked) {
      this.deadT += dt;
      this._smokeAcc += dt * 20;
      while (this._smokeAcc > 1) {
        this._smokeAcc -= 1;
        _a.set(rnd(-0.4, 0.4), this.def.dims.h * 0.4, rnd(-1, 0.4)).applyQuaternion(this.quat).add(this.pos);
        this.ctx.particles.smoke(_a, {
          color: Math.random() < 0.45 ? 0xff7722 : 0x333333,
          size: 1.1, life: 1.1, vy: 2.2,
        });
      }
      if (!this.exploded && this.deadT > 1.6) {
        this.exploded = true;
        for (const p of this.parts) if (p.attached) this.detachPart(p, 6);
        this.wheels.forEach((w, i) => { if (!w.steered) this.detachWheel(i, 4); });
        for (const m of this.bodyMeshes) m.material.color?.setHex(0x181818);
        this.body.applyImpulse({ x: 0, y: this.def.mass * 4.5, z: 0 }, true);
        this.ctx.particles.burst(this.pos, 2.2);
        this.ctx.particles.burst({ x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z }, 1.6);
        this.ctx.audio.boom(this.isPlayer ? 1 : 0.55);
        this.ctx.onBoom?.(this);
      }
    }
  }

  resetUpright(turbo = false) {
    const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    _q.setFromAxisAngle(UP, yaw);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + 1.4, z: this.pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerCur = 0;
    this.flipT = 0;
    if (turbo) this.turboT = CONF.COMEBACK_T;
  }

  resetTo(pos, heading) {
    _q.setFromAxisAngle(UP, heading);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerCur = 0; this.flipT = 0;
  }

  partMask() {
    let m = 0;
    this.parts.forEach((p, i) => { if (p.attached) m |= (1 << i); });
    return m;
  }

  breakWheel(i) {
    const w = this.wheels[i];
    if (!w || w.broken || w.detached) return;
    w.broken = true;
    w.radius *= 0.8; // punktering: hörnet sjunker
    _a.copy(w.anchorL).applyQuaternion(this.quat).add(this.pos);
    this.ctx.particles.sparks(_a, 26, 0xffc060, 8, { life: 0.6 });
    this.ctx.onWheelBreak?.(this, i, _a);
  }

  brokenMask() {
    let m = 0;
    this.wheels.forEach((w, i) => { if (w.broken) m |= (1 << i); });
    return m;
  }

  wheelMask() {
    let m = 0;
    this.wheels.forEach((w, i) => { if (!w.detached) m |= (1 << i); });
    return m;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ctx.raceMgr?.dropCar(this);
    this.ctx.carsByCollider.delete(this.collider.handle);
    this.ctx.world.removeRigidBody(this.body);
    this.ctx.scene.remove(this.group);
    const idx = this.ctx.allCars.indexOf(this);
    if (idx >= 0) this.ctx.allCars.splice(idx, 1);
    this.ctx.onDespawnCar?.(this);
  }
}
