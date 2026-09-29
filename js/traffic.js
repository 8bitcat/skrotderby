// Civiltrafik på mega-rakan: högertrafik i färdriktningen på ena sidan,
// MÖTANDE trafik på andra sidan mittrefugerna. Håller sig kring fältet
// (eller kring startområdet när inget race pågår) och återvinns när de
// hamnat för långt bort. Kör man sönder dem ger det skrotpoäng.
import * as THREE from 'three';
import { CONF, CARS } from './config.js?v=24';
import { Car, spawnY } from './vehicle.js?v=24';
import { trackZ, laneYaw } from './world.js?v=24';

const hash = (i) => ((Math.sin(i * 127.31) * 43758.5453) % 1 + 1) % 1;

// Körfält: negativa z = i färdriktningen (-x), positiva z = MÖTANDE (+x)
const LANES = [
  { z: -9.5, dir: -1 }, { z: -13.5, dir: -1 },
  { z: 9.5, dir: 1 }, { z: 13.5, dir: 1 },
];

export class Traffic {
  constructor(ctx, worldApi) {
    this.ctx = ctx;
    this.world = worldApi;
    this.list = [];
    this._seq = 0;
    this._mgmtT = 0;
  }

  _band() {
    // Var är fältet? Främsta/bakersta icke-trafikbil på södra rakan
    const { HZ } = CONF.TRACK;
    let front = Infinity, rear = -Infinity;
    for (const c of this.ctx.allCars) {
      if (c.isTraffic || c.disposed) continue;
      if (Math.abs(c.pos.z - trackZ(c.pos.x)) < 30 && c.pos.x < CONF.STAGE_X + 100) {
        front = Math.min(front, c.pos.x);
        rear = Math.max(rear, c.pos.x);
      }
    }
    if (front === Infinity) {
      front = CONF.STAGE_X - 1800;
      rear = CONF.STAGE_X - 100;
    }
    return { front, rear };
  }

  _spawnOne(band) {
    const { HZ } = CONF.TRACK;
    this._seq++;
    const lane = LANES[this._seq % LANES.length];
    const defId = CONF.VALBARA + (this._seq % 3);
    const def = CARS[defId];
    const x = band.front - 150 - hash(this._seq) * 700;
    const pos = new THREE.Vector3(x, spawnY(def), trackZ(x) + lane.z);
    const heading = (lane.dir < 0 ? Math.PI / 2 : -Math.PI / 2) - laneYaw(x) * lane.dir;
    const car = new Car(this.ctx, def, pos, heading, { name: '', defId });
    car.isTraffic = true;
    car.lane = lane;
    this.ctx.onSpawnCar?.(car);
    this.list.push(car);
    return car;
  }

  _recycle(car, band) {
    const { HZ } = CONF.TRACK;
    this._seq++;
    const lane = LANES[this._seq % LANES.length];
    car.lane = lane;
    const x = band.front - 150 - hash(this._seq + 31) * 700;
    car.resetTo(new THREE.Vector3(x, 1.4, trackZ(x) + lane.z), (lane.dir < 0 ? Math.PI / 2 : -Math.PI / 2) - laneYaw(x) * lane.dir);
    car.health = car.maxHealth;
  }

  update(dt) {
    const { HZ } = CONF.TRACK;
    this._mgmtT += dt;
    const manage = this._mgmtT > 1;
    if (manage) this._mgmtT = 0;

    if (manage) {
      const band = this._band();
      const max = this.world.variant?.trafik ?? CONF.TRAFIK_MAX;
      while (this.list.length < max) this._spawnOne(band);
      while (this.list.length > max) {
        const c = this.list.pop();
        if (!c.disposed) c.dispose();
      }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const car = this.list[i];
        if (car.disposed) { this.list.splice(i, 1); continue; }
        if (car.wrecked) {
          if (car.deadT > 6) { car.dispose(); this.list.splice(i, 1); }
          continue;
        }
        // För långt bakom/framför fältet → återvinn framåt
        if (car.pos.x > band.rear + 600 || car.pos.x < band.front - 1400 ||
            Math.abs(car.pos.z - trackZ(car.pos.x)) > 26 || car.pos.x < CONF.STAGE_X - CONF.RACE_DIST + 200) {
          this._recycle(car, band);
        }
      }
    }

    // Körning: håll filen, lagom fart
    for (const car of this.list) {
      if (car.wrecked || car.disposed) continue;
      const lane = car.lane || LANES[0];
      const targetX = car.pos.x + (lane.dir < 0 ? -40 : 40);
      const targetZ = trackZ(targetX) + lane.z;
      const dx = targetX - car.pos.x, dz = targetZ - car.pos.z;
      let fx = car.fwd.x, fz = car.fwd.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      const ang = Math.atan2(fz * dx - fx * dz, dx * fx + dz * fz);
      car.input.steer = Math.max(-0.5, Math.min(0.5, ang * 1.4));
      const cruise = 17 + (car.id % 5) * 1.6;
      car.input.throttle = car.absSpeed < cruise ? 0.55 : 0;
      car.input.handbrake = false;
    }
  }
}
