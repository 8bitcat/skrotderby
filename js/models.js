// Riktiga 3D-bilmodeller (RGS_Dev Free Low Poly Vehicles Pack, CC0).
// Varje modell laddas en gång och bakas om till spelets koordinatsystem
// (front mot −z, hjulcentrum på fjädringens viloläge). Karossen delas upp i
// lossningsbara bitar — stötfångare, huv, tak, dörrar, baklucka — skurna ur
// modellens egen geometri, så det är den riktiga bilen som går sönder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CARS } from './config.js?v=20';

// Hjulcentrum ligger så här långt under fjädringsankaret i vila
// (susRest 0.42 − kompression g/(4·26) ≈ 0.13).
export const REST_DROP = 0.29;

export const PART_ORDER = ['stotfangareFram', 'stotfangareBak', 'huv', 'tak', 'dorrV', 'dorrH', 'bagagelucka'];
export const PART_HEALTH = { stotfangareFram: 24, stotfangareBak: 24, huv: 30, tak: 42, dorrV: 32, dorrH: 32, bagagelucka: 26 };

// Fotoskannade props (Poly Haven, CC0): id → [{ name, parts: [{ geo, mat }], size }]
// en post per variant (nod); geometrin centrerad i x/z med botten på y=0.
export const PROPS = {};
const PROP_FILES = ['Barrel_01', 'barrel_03', 'old_tyre', 'wild_rooibos_bush'];

async function loadProps(loader) {
  await Promise.all(PROP_FILES.map(async (id) => {
    try {
      const g = await loader.loadAsync('models/' + id + '.glb');
      g.scene.updateMatrixWorld(true);
      const byNode = new Map();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        // flermaterialsmeshar ligger som barn under sin nod — gruppera per nod
        const node = o.parent && o.parent !== g.scene && !o.parent.isScene ? o.parent : o;
        if (!byNode.has(node)) byNode.set(node, []);
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        const mat = o.material;
        if (mat.transparent || mat.alphaTest > 0) {
          // blad: alfatest istället för blandning (inga sorteringsfel i stora mängder)
          mat.transparent = false;
          mat.alphaTest = 0.12;
          mat.depthWrite = true;
          mat.side = THREE.DoubleSide;
        }
        // rooibos-bladen är gråaktiga i fotot — tona dem gröna så de passar gräset
        if (/leaves/i.test(mat.name)) mat.color.setHex(0x9fd46a);
        if (/twigs/i.test(mat.name)) mat.color.setHex(0xc8b89a);
        byNode.get(node).push({ geo, mat });
      });
      PROPS[id] = [...byNode.entries()].map(([node, parts]) => {
        const bb = new THREE.Box3();
        for (const p of parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
        const off = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        for (const p of parts) p.geo.translate(off.x, off.y, off.z);
        return { name: node.name, parts, size: bb.getSize(new THREE.Vector3()) };
      });
    } catch (e) { console.warn('Prop kunde inte laddas:', id, e); }
  }));
}

let loading = null;
export function loadModels() {
  if (!loading) loading = doLoad();
  return loading;
}

async function doLoad() {
  const loader = new GLTFLoader();
  const propsJob = loadProps(loader);
  const files = [...new Set(CARS.filter(d => d.model).map(d => d.model.fil))];
  const scenes = new Map();
  await Promise.all(files.map(async (f) => {
    try {
      const g = await loader.loadAsync('models/' + f);
      scenes.set(f, g.scene);
    } catch (e) {
      console.warn('Bilmodell kunde inte laddas — procedurell bil används:', f, e);
    }
  }));
  await propsJob;
  for (const def of CARS) {
    const sc = def.model && scenes.get(def.model.fil);
    if (!sc) continue;
    try { prepare(def, sc); } catch (e) { console.warn('Modellförberedelse misslyckades:', def.id, e); }
  }
}

// Ett enskilt hjul: har 'wheel' i namnet, inte ratt/reservhjul, och säger vilket hörn
const isWheelName = (n) => /wheel/i.test(n) && !/steer|spare/i.test(n) &&
  /(^|[^a-z])(f|r|b)[lr]([^a-z]|$)|wheel_?(f|r|b)[lr]|front|rear|back|left|right|wheel_?0?[1-4]([^0-9]|$)/i.test(n);
const sideOf = (n) => {
  const rest = n.toLowerCase().replace(/^.*wheel[_ ]*/, '');
  if (/^f|front/.test(rest)) return 'F';
  if (/^(r|b)[lr_ ]|rear|back/.test(rest)) return 'R';
  return null;
};
const KARNA = /interior|rollcage_?frame|steer|seat|dash/i; // stannar alltid i karossen

function prepare(def, scene) {
  // Vrid modellen så att fronten pekar mot +z (sedan hanterar N resten)
  scene.rotation.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  {
    const front = new THREE.Vector3(), rear = new THREE.Vector3();
    let nf = 0, nr = 0;
    scene.traverse((o) => {
      if (!isWheelName(o.name)) return;
      if (o.parent && isWheelName(o.parent.name)) return; // bara översta hjulnoden
      const side = sideOf(o.name);
      const p = o.getWorldPosition(new THREE.Vector3());
      if (side === 'F') { front.add(p); nf++; } else if (side === 'R') { rear.add(p); nr++; }
    });
    let yaw = 0;
    if (nf && nr) {
      const dir = front.divideScalar(nf).sub(rear.divideScalar(nr));
      yaw = -Math.atan2(dir.x, dir.z);
    } else if (def.model.fram) {
      yaw = { '+z': 0, '-z': Math.PI, '-x': Math.PI / 2, '+x': -Math.PI / 2 }[def.model.fram] ?? 0;
    }
    scene.rotation.y = yaw;
    scene.updateMatrixWorld(true);
  }
  const bort = new Set(def.model.bort || []);
  const matName = (m) => (m && m.name) || '';
  const src = new Map();
  scene.traverse((o) => { if (o.isMesh && o.material && !src.has(matName(o.material))) src.set(matName(o.material), o.material); });

  // Sortera meshar: hjul (grupperade per hjulnod) och kaross
  const wheelGroups = new Map();
  const body = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (bort.has(matName(o.material))) return;
    // Hjulnoden = översta förfadern med "wheel" i namnet (flermaterialsmeshar
    // blir en grupp med en mesh per material under noden)
    let owner = null;
    for (let p = o; p && p !== scene; p = p.parent) if (isWheelName(p.name)) owner = p;
    if (owner) {
      if (!wheelGroups.has(owner)) wheelGroups.set(owner, []);
      wheelGroups.get(owner).push(o);
    } else body.push(o);
  });
  if (wheelGroups.size !== 4 || !body.length) throw new Error('oväntad modellstruktur');

  // Mått i modellens egna enheter
  const bbox = new THREE.Box3();
  for (const m of body) bbox.expandByObject(m);
  const hubs = [...wheelGroups.keys()].map(n => n.getWorldPosition(new THREE.Vector3()));
  const hubY = hubs.reduce((s, h) => s + h.y, 0) / 4;
  const wb = new THREE.Box3();
  for (const m of wheelGroups.values().next().value) wb.expandByObject(m);
  const rModel = (wb.max.y - wb.min.y) / 2;

  const s = def.dims.l / (bbox.max.z - bbox.min.z);
  // Höjden väljs så att kollisionslådan (−0.8h … 0.2h) täcker karossens underkant
  const bottomRel = (bbox.min.y - hubY) * s;
  const h = Math.min(1.6, Math.max(0.9, (0.21 - bottomRel) / 0.3));
  def.dims.h = h;
  def.dims.w = (bbox.max.x - bbox.min.x) * s * 0.9;
  def.wheelR = rModel * s;

  const hubTargetY = -h / 2 + 0.08 - REST_DROP;
  const cx = (bbox.min.x + bbox.max.x) / 2, cz = (bbox.min.z + bbox.max.z) / 2;
  // N = T(0, yoff) · S(s) · Ry(π) · T(−cx, 0, −cz) — front (+z i modellen) → −z
  const N = new THREE.Matrix4().makeTranslation(0, hubTargetY - hubY * s, 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));

  // --- Hjul: ordning FL, FR, RL, RR (x<0 = vänster, z<0 = fram) ---
  const wheels = [null, null, null, null];
  const anchor = { x: 0, zF: 0, zR: 0 };
  for (const [node, meshes] of wheelGroups) {
    const hub = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(N);
    const idx = (hub.z < 0 ? 0 : 2) + (hub.x < 0 ? 0 : 1);
    wheels[idx] = meshes.map((m) => {
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.applyMatrix4(N);
      geo.translate(-hub.x, -hub.y, -hub.z);
      return { geo, mat: matName(m.material) };
    });
    anchor.x += Math.abs(hub.x) / 4;
    if (hub.z < 0) anchor.zF += hub.z / 2; else anchor.zR += hub.z / 2;
  }
  if (wheels.some(w => !w)) throw new Error('hjulen gick inte att para ihop');

  // --- Kaross: baka, dela upp triangel för triangel i regioner ---
  const baked = body.map((m) => {
    let geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.applyMatrix4(N);
    if (geo.index) geo = geo.toNonIndexed();
    return { geo, mat: matName(m.material) };
  });
  const box = new THREE.Box3();
  for (const b of baked) { b.geo.computeBoundingBox(); box.union(b.geo.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));

  const classify = (px, py, pz, nx, ny, mat) => {
    const u = (pz - box.min.z) / size.z;           // 0 = front, 1 = bak
    const vy = (py - box.min.y) / size.y;
    const sx = px / halfW;
    const glas = /window|glass|glas/i.test(mat);
    if (u < 0.075 && vy < 0.55) return 'stotfangareFram';
    if (u > 0.925 && vy < 0.55) return 'stotfangareBak';
    if (!glas && vy > 0.8 && ny > 0.55) return 'tak';
    if (!glas && u < 0.36 && ny > 0.4 && vy > 0.3 && vy < 0.72) return 'huv';
    if (!glas && u > 0.74 && ny > 0.4 && vy > 0.3 && vy < 0.72) return 'bagagelucka';
    if (u > 0.3 && u < 0.66 && vy > 0.15 && vy < 0.75) {
      if (sx < -0.7 && nx < -0.45) return 'dorrV';
      if (sx > 0.7 && nx > 0.45) return 'dorrH';
    }
    return null;
  };

  const buckets = new Map(); // "region|mat" → {pos, nor, uv}
  const bucket = (reg, mat) => {
    const k = reg + '|' + mat;
    if (!buckets.has(k)) buckets.set(k, { reg, mat, pos: [], nor: [], uv: [] });
    return buckets.get(k);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (const { geo, mat } of baked) {
    const P = geo.attributes.position, Nn = geo.attributes.normal, U = geo.attributes.uv;
    for (let t = 0; t < P.count; t += 3) {
      a.fromBufferAttribute(P, t); b.fromBufferAttribute(P, t + 1); c.fromBufferAttribute(P, t + 2);
      fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      const reg = KARNA.test(mat) ? 'kaross'
        : (classify((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, fn.x, fn.y, mat) || 'kaross');
      const bk = bucket(reg, mat);
      for (let k = 0; k < 3; k++) {
        bk.pos.push(P.getX(t + k), P.getY(t + k), P.getZ(t + k));
        if (Nn) bk.nor.push(Nn.getX(t + k), Nn.getY(t + k), Nn.getZ(t + k));
        else bk.nor.push(fn.x, fn.y, fn.z);
        if (U) bk.uv.push(U.getX(t + k), U.getY(t + k));
      }
    }
  }

  const toGeo = (bk) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
    if (bk.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    return g;
  };

  // Regioner med för få trianglar läggs tillbaka i karossen (deterministiskt)
  const regTris = new Map();
  for (const bk of buckets.values()) regTris.set(bk.reg, (regTris.get(bk.reg) || 0) + bk.pos.length / 9);
  const core = [];
  const regions = {};
  for (const bk of buckets.values()) {
    const keep = bk.reg !== 'kaross' && regTris.get(bk.reg) >= 6;
    if (!keep) { core.push({ geo: toGeo(bk), mat: bk.mat }); continue; }
    (regions[bk.reg] ??= { geos: [] }).geos.push({ geo: toGeo(bk), mat: bk.mat });
  }
  const partOrder = PART_ORDER.filter(n => regions[n]);
  for (const n of partOrder) {
    const R = regions[n];
    const rb = new THREE.Box3();
    for (const g of R.geos) { g.geo.computeBoundingBox(); rb.union(g.geo.boundingBox); }
    R.center = rb.getCenter(new THREE.Vector3());
    R.size = rb.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.1, 0.1, 0.1));
    for (const g of R.geos) g.geo.translate(-R.center.x, -R.center.y, -R.center.z);
    // Hitta den verkliga ytan (för dekaler och vinge): stråla mot delen
    const probe = new THREE.Group();
    const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const g of R.geos) probe.add(new THREE.Mesh(g.geo, dbl));
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    const top = ray.intersectObject(probe, true)[0];
    R.topY = top ? top.point.y : R.size.y / 2;
    const sx = n === 'dorrV' ? -1 : 1;
    R.sideY = -R.size.y * 0.2; // under fönsterlinjen
    ray.set(new THREE.Vector3(sx * 10, R.sideY, 0), new THREE.Vector3(-sx, 0, 0));
    const sideHit = ray.intersectObject(probe, true)[0];
    R.sideX = sideHit ? sideHit.point.x : sx * R.size.x / 2;
  }

  def._m = { core, regions, partOrder, wheels, anchor, box, size, src, wheelMats: new Map() };
}
