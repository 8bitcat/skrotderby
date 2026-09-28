// Gnistor (Points, additiv) + rök/eld (sprite-pool). Helt procedurellt.
import * as THREE from 'three';

const MAXP = 2600;
const MAXSMOKE = 120;

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Particles {
  constructor(scene) {
    this.scene = scene;

    // Gnistor
    const geo = new THREE.BufferGeometry();
    this.posA = new Float32Array(MAXP * 3);
    this.colA = new Float32Array(MAXP * 3);
    this.posA.fill(-9999);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posA, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 3));
    this.vel = new Float32Array(MAXP * 3);
    this.life = new Float32Array(MAXP);
    this.head = 0;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.17, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Rök
    this.blob = blobTexture();
    this.smokes = [];
    this.pool = [];
    for (let i = 0; i < MAXSMOKE; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.blob, transparent: true, opacity: 0, depthWrite: false,
      }));
      sp.visible = false;
      scene.add(sp);
      this.pool.push(sp);
    }
    this._col = new THREE.Color();
  }

  // opts: { dir:{x,z}, bias (0..1 hur mycket riktning), life, colors:[hex,...] }
  sparks(pos, n, color = 0xffb347, speed = 9, opts = {}) {
    const dir = opts.dir, bias = opts.bias ?? 0;
    const cols = opts.colors;
    for (let k = 0; k < n; k++) {
      if (cols) this._col.setHex(cols[(Math.random() * cols.length) | 0]);
      else this._col.setHex(color);
      const i = this.head;
      this.head = (this.head + 1) % MAXP;
      this.posA[i * 3] = pos.x + (Math.random() - 0.5) * 0.3;
      this.posA[i * 3 + 1] = pos.y + 0.2;
      this.posA[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.3;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * speed * 0.8;
      const r = Math.random() * speed;
      let vx = Math.cos(a) * r, vz = Math.sin(a) * r;
      if (dir && bias) { vx = vx * (1 - bias) + dir.x * speed * bias; vz = vz * (1 - bias) + dir.z * speed * bias; }
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = vz;
      this.life[i] = (opts.life || 0.5) * (0.6 + Math.random() * 0.8);
      const f = 0.6 + Math.random() * 0.4;
      this.colA[i * 3] = this._col.r * f;
      this.colA[i * 3 + 1] = this._col.g * f;
      this.colA[i * 3 + 2] = this._col.b * f;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // Krock-explosion: gnistor + rök + orange eldflaga
  burst(pos, power = 1) {
    this.sparks(pos, Math.round(28 * power), 0, 10 + 6 * power, {
      colors: [0xffd050, 0xff8020, 0xffb347, 0xfff0b0], life: 0.7,
    });
    this.sparks(pos, Math.round(14 * power), 0, 4 + 3 * power, {
      colors: [0x888888, 0x555555, 0x333333], life: 1.1,
    });
    for (let k = 0; k < Math.round(3 * power); k++) {
      this.smoke({ x: pos.x + (Math.random() - 0.5), y: pos.y + 0.3, z: pos.z + (Math.random() - 0.5) },
        { color: k === 0 ? 0xff7722 : 0x444444, size: 0.8 + Math.random(), life: 0.9 + Math.random() * 0.6, vy: 2.4 });
    }
  }

  smoke(pos, { color = 0x555555, size = 0.9, life = 1.3, vy = 1.6 } = {}) {
    let sp = this.pool.pop();
    if (!sp) {
      const oldest = this.smokes.shift();
      if (!oldest) return;
      sp = oldest.sp;
    }
    sp.visible = true;
    sp.material.color.setHex(color);
    sp.material.opacity = 0.5;
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    this.smokes.push({
      sp, life, maxLife: life,
      vx: (Math.random() - 0.5) * 0.8, vy: vy + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.8,
      grow: size * 1.1,
    });
  }

  update(dt) {
    // Gnistor
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.posA[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3 + 1] -= 16 * dt;
      this.posA[i * 3] += this.vel[i * 3] * dt;
      this.posA[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.posA[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.posA[i * 3 + 1] < 0.02) this.posA[i * 3 + 1] = 0.02;
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // Rök
    for (let s = this.smokes.length - 1; s >= 0; s--) {
      const m = this.smokes[s];
      m.life -= dt;
      if (m.life <= 0) {
        m.sp.visible = false;
        this.smokes.splice(s, 1);
        this.pool.push(m.sp);
        continue;
      }
      m.sp.position.x += m.vx * dt;
      m.sp.position.y += m.vy * dt;
      m.sp.position.z += m.vz * dt;
      m.sp.scale.addScalar(m.grow * dt);
      m.sp.material.opacity = 0.5 * (m.life / m.maxLife);
    }
  }
}
