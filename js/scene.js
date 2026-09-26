// Renderare, ljus, himmel och jaktkamera — uppdaterad grafik:
// ACES-tonmappning, miljöreflektioner (PMREM), himmelsgradient + moln.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

function hash(i) { return (Math.sin(i * 127.31) * 43758.5453) % 1 * 0.5 + 0.5; }

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const c = cv.getContext('2d');
  for (const [x, y, r] of [[70, 80, 45], [120, 65, 55], [180, 82, 42], [95, 92, 38], [150, 95, 40]]) {
    const g = c.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 128);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createScene() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd8f5);
  scene.fog = new THREE.Fog(0xc4dcf2, 260, 1050);

  // Miljöreflektioner — gör billack, krom och glas levande
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.55;

  // Himmelskupol med gradient
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1300, 20, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d7fd9) },
        bot: { value: new THREE.Color(0xd8ecff) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,pow(max(h,0.0),0.55)),1.0); }',
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // Moln
  const cloudTex = cloudTexture();
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false, fog: false,
    }));
    const a = hash(i) * Math.PI * 2;
    const r = 350 + hash(i + 40) * 550;
    sp.position.set(Math.cos(a) * r * 1.6, 150 + hash(i + 80) * 130, Math.sin(a) * r);
    const s = 90 + hash(i + 120) * 140;
    sp.scale.set(s, s * 0.42, 1);
    scene.add(sp);
  }

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2600);
  camera.position.set(6440, 30, 60);

  scene.add(new THREE.HemisphereLight(0xd8e8ff, 0x51653f, 0.65));
  const sun = new THREE.DirectionalLight(0xfff2da, 1.45);
  sun.position.set(6600, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.far = 400;
  scene.add(sun);
  scene.add(sun.target);

  // Bloom får strålkastare, boost-plattor och grindljus att GLÖDA
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.5, 0.85
  ));
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // Himlen följer kameran så kupolen aldrig tar slut på 13 km-rakan
  return { renderer, scene, camera, sun, sky, composer };
}

const MODES = [
  { d: 9, h: 3.4 },
  { d: 14, h: 5.2 },
  { d: 5.5, h: 2.1 },
];

export class ChaseCam {
  constructor(camera, sky) {
    this.camera = camera;
    this.sky = sky;
    this.mode = 0;
    this.pos = new THREE.Vector3(6440, 30, 60);
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

    const wantFov = 62 + Math.min(22, kmh * 0.08);
    this._fov += (wantFov - this._fov) * Math.min(1, 4 * dt);
    if (Math.abs(this.camera.fov - this._fov) > 0.1) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.sky) this.sky.position.set(this.pos.x, 0, this.pos.z);
  }
}
