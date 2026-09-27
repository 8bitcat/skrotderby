// Gästens bild av en bil: interpolerar värdens snapshots, släpper delar visuellt
// och röker/brinner utifrån hälsoflaggorna. Ingen fysik körs här.
import * as THREE from 'three';
import { CARS } from './config.js?v=11';
import { buildCarVisual, buildWheelMesh, wheelAnchors, makeNameSprite } from './carstyles.js?v=11';

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class CarView {
  constructor(scene, id, defId, name, isMine) {
    this.scene = scene;
    this.id = id;
    this.defId = defId;
    this.name = name;
    const def = CARS[defId] ?? CARS[0];
    this.def = def;

    const built = buildCarVisual(def);
    this.group = built.group;
    this.parts = built.parts;
    this.bodyMeshes = built.bodyMeshes;

    const rest = (def.susRest || 0.42) - 0.13;
    this.wheels = wheelAnchors(def).map((a, i) => {
      const { holder, spin } = buildWheelMesh(def, i);
      holder.position.set(a.x, a.y - rest, a.z);
      this.group.add(holder);
      return { holder, spin, steered: a.steered, radius: def.wheelR };
    });

    if (!isMine) {
      this.label = makeNameSprite(name);
      this.label.position.set(0, def.dims.h + 0.9, 0);
      this.group.add(this.label);
    }
    scene.add(this.group);
    this.group.visible = false;

    this.buf = [];
    this.pos = new THREE.Vector3(0, -100, 0);
    this.quat = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.kmh = 0; this.health01 = 1; this.steer = 0; this.score = 0;
    this.wrecked = false; this.exploded = false; this.turbo = false;
    this.status = 0;
    this.spin = 0;
    this._smokeAcc = 0;
  }

  pushState(t, row) {
    this.buf.push({ t, x: row[1], y: row[2], z: row[3], qx: row[4], qy: row[5], qz: row[6], qw: row[7] });
    if (this.buf.length > 12) this.buf.shift();
    this.steer = row[8];
    this.kmh = row[9];
    this.health01 = row[10] / 100;
    const flags = row[11];
    this.wrecked = !!(flags & 1);
    this.turbo = !!(flags & 4);
    if ((flags & 2) && !this.exploded) {
      this.exploded = true;
      for (const m of this.bodyMeshes) m.material.color?.setHex(0x181818);
    }
    this.applyMasks(row[12], row[13]);
    this.score = row[14] || 0;
    this.status = row[15];
  }

  // Delar som värden säger är borta men som vi inte fått kast-event för → göm tyst
  applyMasks(pm, wm) {
    this.parts.forEach((p, i) => {
      if (p.attached && !(pm & (1 << i))) {
        p.attached = false;
        p.mesh.parent?.remove(p.mesh);
      }
    });
    this.wheels.forEach((w, i) => {
      if (!(wm & (1 << i)) && w.holder.parent === this.group) {
        this.group.remove(w.holder);
      }
    });
  }

  _freeToWorld(obj) {
    obj.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    obj.matrixWorld.decompose(wp, wq, ws);
    obj.parent?.remove(obj);
    this.scene.add(obj);
    obj.position.copy(wp);
    obj.quaternion.copy(wq);
  }

  // Från 'los'-event: lossa delen och lämna över meshen till klientens ballistik
  detachNamed(partName) {
    if (partName.startsWith('hjul')) {
      const i = +partName.slice(4);
      const w = this.wheels[i];
      if (!w || w.holder.parent !== this.group) return null;
      this._freeToWorld(w.holder);
      const s = w.radius * 2;
      return { mesh: w.holder, size: new THREE.Vector3(s, s, s) };
    }
    const p = this.parts.find(q => q.name === partName && q.attached);
    if (!p) return null;
    p.attached = false;
    this._freeToWorld(p.mesh);
    return { mesh: p.mesh, size: p.size };
  }

  update(dt, renderT, particles) {
    const b = this.buf;
    if (b.length) {
      this.group.visible = true;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > renderT) i--;
      const s2 = b[i], s1 = b[Math.max(0, i - 1)];
      const span = Math.max(1e-3, s2.t - s1.t);
      const a = Math.max(0, Math.min(1, (renderT - s1.t) / span));
      this.pos.set(s1.x + (s2.x - s1.x) * a, s1.y + (s2.y - s1.y) * a, s1.z + (s2.z - s1.z) * a);
      _q1.set(s1.qx, s1.qy, s1.qz, s1.qw);
      _q2.set(s2.qx, s2.qy, s2.qz, s2.qw);
      this.quat.copy(_q1).slerp(_q2, a);
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(this.quat);
      this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    }

    this.spin += (this.kmh / 3.6) / this.def.wheelR * dt;
    for (const w of this.wheels) {
      if (w.holder.parent !== this.group) continue;
      w.holder.rotation.y = w.steered ? this.steer : 0;
      w.spin.rotation.x = -this.spin;
    }

    if (particles && this.group.visible) {
      if (!this.wrecked && this.health01 < 0.45) {
        this._smokeAcc += dt * (0.5 - this.health01) * 14;
        while (this._smokeAcc > 1) {
          this._smokeAcc -= 1;
          _v.set(0, this.def.dims.h * 0.3, -this.def.dims.l * 0.3).applyQuaternion(this.quat).add(this.pos);
          particles.smoke(_v, { color: 0x555555, size: 0.9, life: 1.4 });
        }
      }
      if (this.wrecked) {
        this._smokeAcc += dt * 18;
        while (this._smokeAcc > 1) {
          this._smokeAcc -= 1;
          _v.set((Math.random() - 0.5) * 0.8, this.def.dims.h * 0.4, (Math.random() - 0.5) * 1.4)
            .applyQuaternion(this.quat).add(this.pos);
          particles.smoke(_v, {
            color: Math.random() < 0.45 ? 0xff7722 : 0x333333,
            size: 1.1, life: 1.1, vy: 2.2,
          });
        }
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
