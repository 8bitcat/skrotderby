// Renderare, ljus och jaktkamera i tredjeperson
import * as THREE from 'three';

export function createScene() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e8);
  scene.fog = new THREE.Fog(0x87b5e8, 180, 640);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
  camera.position.set(-80, 30, 60);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a5b3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.6);
  sun.position.set(80, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.far = 400;
  scene.add(sun);
  scene.add(sun.target);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera, sun };
}

const MODES = [
  { d: 9, h: 3.6 },
  { d: 14, h: 5.4 },
  { d: 5.5, h: 2.2 },
];

export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(-80, 30, 60);
    this.look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._wl = new THREE.Vector3();
    this._fov = 62;
  }

  toggle() { this.mode = (this.mode + 1) % MODES.length; }

  snap(pos) { this.pos.copy(pos).add(new THREE.Vector3(0, 6, 12)); }

  update(dt, targetPos, fwd, kmh) {
    const m = MODES[this.mode];
    this._fwd.set(fwd.x, 0, fwd.z);
    if (this._fwd.lengthSq() < 1e-4) this._fwd.set(0, 0, -1);
    this._fwd.normalize();

    this._want.copy(targetPos).addScaledVector(this._fwd, -m.d);
    this._want.y = targetPos.y + m.h;
    this.pos.lerp(this._want, 1 - Math.exp(-5 * dt));
    if (this.pos.y < 0.8) this.pos.y = 0.8;
    this.camera.position.copy(this.pos);

    this._wl.copy(targetPos).addScaledVector(this._fwd, 6);
    this._wl.y += 1.3;
    this.look.lerp(this._wl, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(this.look);

    const wantFov = 62 + Math.min(20, kmh * 0.085);
    this._fov += (wantFov - this._fov) * Math.min(1, 4 * dt);
    if (Math.abs(this.camera.fov - this._fov) > 0.1) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
