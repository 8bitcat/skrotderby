// Världsbygget v2: MEGA-raksträckan (~13 km race), navet i öster med lobby +
// skrotarena, väggar hela vägen (adaptivt sammanslagna segment), curbs,
// kantlinjer, träd, km-skyltar. Grafik alltid — kolliders bara hos värden.
import * as THREE from 'three';
import { CONF, CARS } from './config.js?v=17';
import { buildCarVisual, buildWheelMesh, wheelAnchors } from './carstyles.js?v=17';
import { PROPS } from './models.js?v=17';

const UP = new THREE.Vector3(0, 1, 0);
const hash = (i) => ((Math.sin(i * 127.31) * 43758.5453) % 1 + 1) % 1;

// ---------- Sökvägs-hjälpare (delas med race.js & ai.js) ----------
export function makePath(pts) {
  const cum = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (i < pts.length - 1) cum.push(cum[i] + L);
    total += L;
  }
  return { pts, cum, total };
}

export function pathPointAt(path, param, out = {}) {
  const { pts, cum, total } = path;
  let p = ((param % total) + total) % total;
  let i = 0;
  for (let k = pts.length - 1; k >= 0; k--) { if (cum[k] <= p) { i = k; break; } }
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const segLen = (i + 1 < pts.length ? cum[i + 1] : total) - cum[i];
  const t = segLen > 0 ? (p - cum[i]) / segLen : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.tx = (b.x - a.x) / dl;
  out.tz = (b.z - a.z) / dl;
  return out;
}

function roundedRectPath(hx, hz, r, arcSeg = 8, straightSeg = 24) {
  const pts = [];
  const cs = [
    [hx - r, hz - r, 0],
    [-(hx - r), hz - r, Math.PI / 2],
    [-(hx - r), -(hz - r), Math.PI],
    [hx - r, -(hz - r), Math.PI * 1.5],
  ];
  for (let ci = 0; ci < 4; ci++) {
    const [cx, cz, a0] = cs[ci];
    for (let k = 0; k < arcSeg; k++) {
      const a = a0 + (k / arcSeg) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + r * Math.cos(a), 0, cz + r * Math.sin(a)));
    }
    const aEnd = a0 + Math.PI / 2;
    const pEnd = new THREE.Vector3(cx + r * Math.cos(aEnd), 0, cz + r * Math.sin(aEnd));
    const [nx, nz, na0] = cs[(ci + 1) % 4];
    const pNext = new THREE.Vector3(nx + r * Math.cos(na0), 0, nz + r * Math.sin(na0));
    for (let k = 0; k < straightSeg; k++) pts.push(pEnd.clone().lerp(pNext, k / straightSeg));
  }
  return pts;
}

function rotateToNearest(pts, tx, tz) {
  let best = 0, bd = Infinity;
  pts.forEach((p, i) => {
    const d = (p.x - tx) ** 2 + (p.z - tz) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return pts.slice(best).concat(pts.slice(0, best));
}

function resamplePath(path, spacing) {
  const out = [];
  const n = Math.max(8, Math.round(path.total / spacing));
  const o = {};
  for (let i = 0; i < n; i++) {
    pathPointAt(path, (i / n) * path.total, o);
    out.push(new THREE.Vector3(o.x, 0, o.z));
  }
  return out;
}

// Slår ihop kollinjära bitar → långa väggsegment på rakorna, korta i kurvorna
function mergedSegs(path, spacing = 10, maxLen = 70) {
  const dense = resamplePath(path, spacing);
  const segs = [];
  let start = dense[0], prev = dense[0], dirx = 0, dirz = 0, len = 0;
  for (let i = 1; i <= dense.length; i++) {
    const p = dense[i % dense.length];
    const dx = p.x - prev.x, dz = p.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1e-9;
    const ndx = dx / dl, ndz = dz / dl;
    if (len > 0 && (ndx * dirx + ndz * dirz < 0.9998 || len + dl > maxLen)) {
      segs.push({ a: start, b: prev });
      start = prev;
      len = 0;
    }
    if (len === 0) { dirx = ndx; dirz = ndz; }
    len += dl;
    prev = p;
  }
  if (len > 0.5) segs.push({ a: start, b: prev });
  return segs;
}

// ---------- Textur-hjälpare ----------
// Högupplösta PBR-texturer (Poly Haven, CC0) — ligger i textures/
function pbr(name, rx, ry, res = '1k') {
  const L = new THREE.TextureLoader();
  const map = L.load('textures/' + name + '_diff_' + res + '.jpg');
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, ry);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  const normalMap = L.load('textures/' + name + '_nor_gl_' + res + '.jpg');
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, ry);
  normalMap.anisotropy = 8;
  return { map, normalMap };
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (repeat !== true) tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function stripeMat() {
  const tex = canvasTex(128, 64, (c) => {
    c.fillStyle = '#e88b1e'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#20242a';
    for (let x = -64; x < 128; x += 32) {
      c.beginPath();
      c.moveTo(x, 64); c.lineTo(x + 16, 64); c.lineTo(x + 48, 0); c.lineTo(x + 32, 0);
      c.closePath(); c.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
}

// ---------- Fysik-hjälpare ----------
function fixedBox(ctx, x, y, z, hx, hy, hz, yaw = 0, noDmg = false, rotX = 0, rotZ = 0, frict = 0.4) {
  if (!ctx.world) return null;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, yaw, rotZ));
  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
  );
  const col = ctx.world.createCollider(
    ctx.RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(frict).setRestitution(0.4),
    body
  );
  if (noDmg) ctx.noDmg.add(col.handle);
  return { body, col };
}

// ---------- Huvudbygget ----------
export function buildWorld(ctx) {
  const { scene } = ctx;
  const { WX, WZ } = CONF.WORLD;
  const { HX, HZ, R, W } = CONF.TRACK;
  const LC = CONF.LOBBY, AC = CONF.ARENA, SX = CONF.STAGE_X, AR = 58;

  // Mark — högupplöst gräs/sten-PBR
  const grassPbr = pbr('aerial_grass_rock', WX / 9, WZ / 9, '2k');
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WX * 2, WZ * 2),
    new THREE.MeshStandardMaterial({ ...grassPbr, color: 0x8fb573, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  fixedBox(ctx, 0, -1, 0, WX, 1, WZ, 0, true);

  // Yttervägg runt världen
  for (const [x, z, hx, hz] of [[0, -WZ + 6, WX, 1], [0, WZ - 6, WX, 1], [-WX + 6, 0, 1, WZ], [WX - 6, 0, 1, WZ]]) {
    fixedBox(ctx, x, 2.5, z, hx, 2.5, hz, 0, true);
  }

  // ============ LÅNGRACET — 13 km raksträcka ============
  let racePts = roundedRectPath(HX, HZ, R);
  racePts = rotateToNearest(racePts, SX, HZ);
  const racePath = makePath(racePts);

  // Asfalt — högupplöst PBR (u längs banan bakat i UV, v-repeat = 4 tvärs)
  const asphaltPbr = pbr('asphalt_02', 1, 4, '2k');
  scene.add(buildRibbon(racePts, racePath, W, asphaltPbr));

  // Mittstreck
  const dense14 = resamplePath(racePath, 14);
  addDashes(scene, dense14, 0.05);

  // Kantlinjer + väggar från sammanslagna segment
  const TRAIN_X = SX - CONF.TRAIN_X_KM * 1000;
  const segs = mergedSegs(racePath, 10, 70);
  const raceWallSkip = (mid, inward) => {
    if (Math.abs(mid.x - TRAIN_X) < 9) return true;                       // järnvägen korsar
    if (!inward) return false;
    if (Math.abs(mid.x - SX) < 26 && mid.z > HZ - 22) return true;        // depåöppning
    if (Math.abs(mid.x - (SX - 110)) < 14 && mid.z > HZ - 22) return true; // kör-in-valv
    return false;
  };
  buildWalls(ctx, scene, racePath, W, { height: 2.2, thick: 0.7, skip: raceWallSkip });
  addEdgeLines(scene, segs, W);
  addCurbs(scene, HX, HZ, R, W);

  // Start- och mållinje + portaler
  const startTex = canvasTex(128, 32, (c) => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      c.fillStyle = (x + y) % 2 ? '#e8e8e8' : '#111';
      c.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  for (const lx of [SX, SX - CONF.RACE_DIST]) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(3, W),
      new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.9 })
    );
    line.rotation.set(-Math.PI / 2, 0, 0);
    line.position.set(lx, 0.06, HZ);
    scene.add(line);
  }
  makeArch(ctx, scene, SX, HZ, Math.PI / 2, 'START', W / 2 + 1);
  makeArch(ctx, scene, SX - CONF.RACE_DIST, HZ, Math.PI / 2, '🏁 MÅL', W / 2 + 1);
  makeArch(ctx, scene, SX - 110, HZ - 13, 0, 'KÖR IN — VAR MED DIREKT', 13);

  // km-skyltar längs rakan
  for (let k = 1; k <= 12; k++) {
    makeKmSign(scene, SX - k * 1000, HZ - W / 2 - 3, k + ' km');
  }

  // Sponsorportaler varannan km
  const SPONSORER = ['SKROT-KRAFT', 'DERBY-COLA', 'ROSTFRITT AB', 'KROCK & CO', 'PLÅTIS BILDELAR', 'TURBO-TWIST'];
  [2, 4, 6, 8, 10, 12].forEach((k, i) => {
    makeArch(ctx, scene, SX - k * 1000 - 500, HZ, Math.PI / 2, SPONSORER[i], W / 2 + 1);
  });

  // Betong till refuger/pelare + boost-textur (används av banvarianterna)
  const refM = new THREE.MeshStandardMaterial({ ...pbr('concrete_wall_008', 3, 0.8), roughness: 0.85 });
  const boostTex = canvasTex(64, 128, (c) => {
    c.fillStyle = '#0b3320'; c.fillRect(0, 0, 64, 128);
    c.fillStyle = '#54ff9a';
    for (let y = 8; y < 128; y += 32) {
      c.beginPath();
      c.moveTo(6, y + 18); c.lineTo(32, y); c.lineTo(58, y + 18);
      c.lineTo(58, y + 26); c.lineTo(32, y + 8); c.lineTo(6, y + 26);
      c.closePath(); c.fill();
    }
  });
  // "Förråd" under marken där inaktiva varianters lösa saker parkeras
  fixedBox(ctx, SX - 6500, -499, HZ, 7000, 1, 80, 0, true);

  // ============ BANLIV (alltid aktivt): broar man KÖR över, hopp, vågor ============
  const FEAT_X = [2600, 4600, 9300, 10800]; // håll refuger borta härifrån
  const rampM = new THREE.MeshStandardMaterial({ ...pbr('asphalt_02', 3, 2), roughness: 1 });
  const railM2 = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.6 });
  const slab = (x, y, z, lx, h, lz, rotZ = 0, mat = rampM, noDmg = true, frict = 0.4) => {
    fixedBox(ctx, x, y, z, lx / 2, h / 2, lz / 2, 0, noDmg, 0, rotZ, frict);
    const m = new THREE.Mesh(new THREE.BoxGeometry(lx, h, lz), mat);
    m.position.set(x, y, z);
    m.rotation.z = rotZ;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // KÖRBAR BRO vid 4,6 km — upp, 70 m däck på 4 m höjd, ner
  {
    const B = SX - 4600, ang = Math.atan(4 / 41.5);
    slab(B + 56, 2, HZ, 42.5, 0.4, W, -ang, rampM, true, 0.06);
    slab(B, 3.99, HZ, 70, 0.4, W);
    slab(B - 56, 2, HZ, 42.5, 0.4, W, ang, rampM, true, 0.06);
    for (const sz of [-1, 1]) {
      slab(B, 4.7, HZ + sz * (W / 2 - 0.3), 70, 0.7, 0.5, 0, railM2, false);
    }
    // korsande väg under bron
    const under = new THREE.Mesh(new THREE.PlaneGeometry(9, 240), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 1 }));
    under.rotation.x = -Math.PI / 2;
    under.position.set(B, 0.04, 0);
    scene.add(under);
    makeKmSign(scene, B + 90, HZ - W / 2 - 3, 'BRO!');
  }

  // HOPPBRON vid 9,3 km — ramp upp, 24 m GAP, landningsramp. BILAR SKA FLYGA.
  {
    const B = SX - 9300;
    const upAng = Math.atan(4.6 / 33.6);
    slab(B + 35, 2.3, HZ, 34.5, 0.4, W, -upAng, rampM, true, 0.06);
    for (const sz of [-1, 1]) {
      slab(B + 35, 3.1, HZ + sz * (W / 2 - 0.3), 34, 0.6, 0.5, -upAng, railM2, false);
    }
    const dnAng = Math.atan(4.2 / 40);
    slab(B - 26, 2.05, HZ, 40.5, 0.4, W, dnAng, rampM, true, 0.06);
    makeKmSign(scene, B + 60, HZ - W / 2 - 3, 'HOPP!');
  }

  // VÅGFÄLT vid 2,6 & 10,8 km — tre gupp som ger luft i hög fart
  for (const fx of [2600, 10800]) {
    for (let b = 0; b < 3; b++) {
      const bx = SX - fx - b * 26;
      const ang = Math.atan(0.55 / 6.5);
      slab(bx + 3.2, 0.32, HZ, 7, 0.3, W, -ang, rampM, true, 0.06);
      slab(bx - 3.2, 0.32, HZ, 7, 0.3, W, ang, rampM, true, 0.06);
    }
  }

  // Boostlinje längs HELA banan (utöver variantboostarna)
  const SHARED_BOOST = [];
  for (let k = 1; k <= 12; k++) {
    const bx = SX - k * 1050 + 180;
    const bz = HZ + (k % 2 ? 11 : -11);
    SHARED_BOOST.push({ x: bx, z: bz, hl: 5, hw: 3.2 });
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 6.4),
      new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.9 })
    );
    pad.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    pad.position.set(bx, 0.055, bz);
    scene.add(pad);
  }

  // Järnväg som korsar BÅDA rakorna + tåg
  const railM = new THREE.MeshStandardMaterial({ color: 0x3c4148, metalness: 0.7, roughness: 0.5 });
  for (const rx of [-0.8, 0.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, WZ * 2 - 24), railM);
    rail.position.set(TRAIN_X + rx, 0.11, 0);
    scene.add(rail);
  }
  for (const cz of [HZ, -HZ]) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(7, W + 4), new THREE.MeshStandardMaterial({ map: stripeMat().map, roughness: 0.8 }));
    plank.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    plank.position.set(TRAIN_X, 0.045, cz);
    scene.add(plank);
  }
  const crossingLights = [];
  for (const cz of [HZ - W / 2 - 2.5, HZ + W / 2 + 2.5, -HZ - W / 2 - 2.5, -HZ + W / 2 + 2.5]) {
    for (const sx of [-6, 6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), new THREE.MeshStandardMaterial({ color: 0xd8d3c8 }));
      post.position.set(TRAIN_X + sx, 1.7, cz);
      scene.add(post);
      const lampM = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), lampM);
      lamp.position.set(TRAIN_X + sx, 3.6, cz);
      scene.add(lamp);
      crossingLights.push(lampM);
    }
  }
  // Tåget: lok + 3 vagnar som EN kinematisk kropp
  const trainGroup = new THREE.Group();
  const wagonColors = [0x8a2f2f, 0x4a5a6a, 0x5d6a48, 0x4a5a6a];
  for (let i = 0; i < 4; i++) {
    const wag = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 3.4, 12),
      new THREE.MeshStandardMaterial({ color: wagonColors[i], roughness: 0.6, metalness: 0.3 })
    );
    wag.position.set(0, 1.9, i * 12.8 - 19.2);
    wag.castShadow = true;
    trainGroup.add(wag);
    if (i === 0) {
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2), new THREE.MeshStandardMaterial({ color: 0x6a2424, roughness: 0.6 }));
      nose.position.set(0, 1.3, -20.6);
      trainGroup.add(nose);
    }
  }
  trainGroup.position.set(TRAIN_X, 0, -2500);
  scene.add(trainGroup);
  let trainBody = null;
  if (ctx.world) {
    trainBody = ctx.world.createRigidBody(
      ctx.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(TRAIN_X, 0, -2500)
    );
    for (let i = 0; i < 4; i++) {
      ctx.world.createCollider(
        ctx.RAPIER.ColliderDesc.cuboid(1.6, 1.7, 6).setTranslation(0, 1.9, i * 12.8 - 19.2),
        trainBody
      );
    }
  }
  const train = {
    x: TRAIN_X, z: -2500, group: trainGroup,
    setZ(z) {
      this.z = z;
      trainGroup.position.z = z;
      trainBody?.setNextKinematicTranslation({ x: TRAIN_X, y: 0, z });
    },
  };

  // Motorvägsbron — kör under den
  const BX = SX - CONF.BRIDGE_X_KM * 1000;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.8, 400),
    new THREE.MeshStandardMaterial({ color: 0x6a7077, roughness: 0.8 })
  );
  deck.position.set(BX, 7.2, 0);
  deck.castShadow = true;
  scene.add(deck);
  fixedBox(ctx, BX, 7.2, 0, 5, 0.4, 200, 0, true);
  for (const sz of [-4.6, 4.6]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 400), new THREE.MeshStandardMaterial({ color: 0x8a9099 }));
    rail.position.set(BX + sz, 8, 0);
    scene.add(rail);
  }
  for (let pz = -175; pz <= 175; pz += 50) {
    if (Math.abs(Math.abs(pz) - HZ) < 26) continue; // inga pelare på banan
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6.8, 1.6), refM);
    pillar.position.set(BX, 3.4, pz);
    pillar.castShadow = true;
    scene.add(pillar);
    fixedBox(ctx, BX, 3.4, pz, 0.8, 3.4, 0.8);
  }

  // Depåficka (öppen söderut mot lobbyn)
  fixedBox(ctx, SX - 23, 0.8, HZ - 32, 0.4, 0.8, 19.5);
  fixedBox(ctx, SX + 23, 0.8, HZ - 32, 0.4, 0.8, 19.5);
  addPocketWalls(scene, [
    [SX - 23, HZ - 32, 0.8, 39],
    [SX + 23, HZ - 32, 0.8, 39],
  ]);
  const raceGates = makeGateRow(ctx, scene, [-20, -12, -4, 4, 12, 20].map(dx => ({ x: SX + dx, z: HZ - 12.6, yaw: 0 })), 4);
  const raceGrid = [];
  for (const zz of [HZ - 48, HZ - 40, HZ - 32, HZ - 24, HZ - 16]) for (const dx of [-18, -10.8, -3.6, 3.6, 10.8, 18]) {
    raceGrid.push({ pos: new THREE.Vector3(SX + dx, 0, zz), heading: Math.PI }); // 30 rutor
  }

  // === TYDLIG STARTFÅLLA: målad yta + ledfyr + pilar från lobbyn ===
  const beacons = [];
  const chevrons = [];
  const fallaTex = canvasTex(512, 512, (c) => {
    c.fillStyle = 'rgba(232,139,30,0.32)'; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = '#ffb64d'; c.lineWidth = 10; c.strokeRect(8, 8, 496, 496);
    c.strokeStyle = 'rgba(255,182,77,0.5)'; c.lineWidth = 4;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(i * 128, 40); c.lineTo(i * 128, 500); c.stroke(); }
    c.fillStyle = '#ffb64d';
    c.font = '900 72px system-ui, sans-serif';
    c.textAlign = 'center';
    c.save(); c.translate(256, 470); c.fillText('STARTFÅLLA', 0, 0); c.restore();
  });
  const falla = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 41),
    new THREE.MeshBasicMaterial({ map: fallaTex, transparent: true, depthWrite: false })
  );
  falla.rotation.x = -Math.PI / 2;
  falla.position.set(SX, 0.048, HZ - 32.5);
  scene.add(falla);
  beacons.push(makeBeacon(scene, SX, HZ - 32, 0xffa02e));
  makeArch(ctx, scene, SX, HZ - 53, Math.PI, '⬇ STARTFÅLLA — STÄLL DIG HÄR ⬇', 24);
  makeChevronTrail(scene, chevrons, [[LC.x - 28, LC.z + 14], [6495, 40], [6470, 62], [SX, HZ - 60]], 9);

  // Derby-fållan får samma hjälp
  beacons.push(makeBeacon(scene, AC.x - AR - 13, AC.z, 0xff5a3c));
  makeChevronTrail(scene, chevrons, [[LC.x - 40, LC.z - 30], [6420, -52], [6330, -66], [6250, -34], [AC.x - AR - 32, AC.z]], 8);

  const raceZone = {
    id: 'race', namn: 'LÅNGRACET', mode: 'race',
    pts: racePts, cum: racePath.cum, total: racePath.total,
    width: W, raceDist: CONF.RACE_DIST, maxT: CONF.RACE_MAX_T,
    staging: { x0: SX - 22, x1: SX + 22, z0: HZ - 52, z1: HZ - 13 },
    entry: new THREE.Vector3(SX, 0, HZ - 64),
    grid: raceGrid, gates: raceGates, gatesOpen: false, race: null, extraGateT: 0,
  };

  // ============ SKROTARENAN ============
  const arenaFloor = new THREE.Mesh(
    new THREE.CircleGeometry(AR, 48),
    new THREE.MeshStandardMaterial({ ...pbr('gravelly_sand', 7, 7), roughness: 1 })
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.set(AC.x, 0.02, AC.z);
  arenaFloor.receiveShadow = true;
  scene.add(arenaFloor);

  const arenaSegs = 48;
  const arenaMats = [];
  for (let i = 0; i < arenaSegs; i++) {
    const a = (i / arenaSegs) * Math.PI * 2;
    const deg = ((a * 180 / Math.PI) + 360) % 360;
    if (deg > 171 && deg < 189) continue;
    const x = AC.x + AR * Math.cos(a), z = AC.z + AR * Math.sin(a);
    const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    const segLen = (2 * Math.PI * AR) / arenaSegs;
    fixedBox(ctx, x, 1.5, z, 0.4, 1.5, segLen / 2 + 0.3, yaw);
    arenaMats.push({ x, z, yaw, segLen });
  }
  addArenaWallMeshes(scene, arenaMats);

  const arenaGates = makeGateRow(ctx, scene, [
    { x: AC.x - AR, z: AC.z - 4.6, yaw: Math.PI / 2 },
    { x: AC.x - AR, z: AC.z + 4.6, yaw: Math.PI / 2 },
  ], 4.6);
  const px0 = AC.x - AR - 25;
  fixedBox(ctx, px0 + 12.5, 0.8, -12.5, 12.5, 0.8, 0.4);
  fixedBox(ctx, px0 + 12.5, 0.8, 12.5, 12.5, 0.8, 0.4);
  addPocketWalls(scene, [
    [px0 + 12.5, -12.5, 25, 0.8],
    [px0 + 12.5, 12.5, 25, 0.8],
  ]);
  const arenaGrid = [];
  for (const dx of [4, 11, 18]) for (const zz of [-7, 0, 7]) {
    arenaGrid.push({ pos: new THREE.Vector3(px0 + dx, 0, zz), heading: -Math.PI / 2 });
  }

  // Hopp-ramp i söder — flyg in i derbyt
  const rampAng = Math.atan(3.2 / 28);
  fixedBox(ctx, AC.x, 1.6, AC.z + AR + 14, 3.5, 0.2, 14, 0, true, rampAng);
  const rampMesh = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.4, 28),
    new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.8 })
  );
  rampMesh.position.set(AC.x, 1.6, AC.z + AR + 14);
  rampMesh.rotation.x = rampAng;
  rampMesh.castShadow = true; rampMesh.receiveShadow = true;
  scene.add(rampMesh);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.5, 28),
      new THREE.MeshStandardMaterial({ color: 0xe88b1e, roughness: 0.6 })
    );
    rail.position.set(AC.x + sx * 3.4, 2.05, AC.z + AR + 14);
    rail.rotation.x = rampAng;
    scene.add(rail);
    fixedBox(ctx, AC.x + sx * 3.4, 2.05, AC.z + AR + 14, 0.125, 0.25, 14, 0, true, rampAng);
  }

  const derbyZone = {
    id: 'derby', namn: 'SKROTARENAN', mode: 'derby',
    center: AC, radius: AR, maxT: CONF.DERBY_MAX_T,
    staging: { x0: px0, x1: px0 + 24, z0: -12, z1: 12 },
    entry: new THREE.Vector3(px0 - 14, 0, 0),
    grid: arenaGrid, gates: arenaGates, gatesOpen: false, race: null, extraGateT: 0,
  };

  // ============ LOBBYN ============
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(62, 48),
    new THREE.MeshStandardMaterial({ ...pbr('asphalt_02', 11, 11), color: 0x8f9296, roughness: 0.95 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(LC.x, 0.02, LC.z);
  plaza.receiveShadow = true;
  scene.add(plaza);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(56, 58, 48),
    new THREE.MeshBasicMaterial({ color: 0xd8d3c8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(LC.x, 0.04, LC.z);
  scene.add(ring);

  const pads = [];
  const displays = [];
  CARS.slice(0, CONF.VALBARA).forEach((def, i) => {
    const ang = (2.05 + i * 0.42);
    const px = LC.x + 44 * Math.cos(ang), pz = LC.z + 44 * Math.sin(ang);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 0.5, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.7, metalness: 0.2 })
    );
    slab.position.set(px, 0.25, pz);
    slab.castShadow = true; slab.receiveShadow = true;
    scene.add(slab);
    fixedBox(ctx, px, 0.25, pz, 2.75, 0.25, 2.75, 0, true);

    const disp = buildDisplayCar(def);
    disp.position.set(px, 0.5 + spawnRest(def), pz);
    scene.add(disp);
    displays.push({ group: disp });

    const padX = LC.x + 35 * Math.cos(ang), padZ = LC.z + 35 * Math.sin(ang);
    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.7, 32),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.set(padX, 0.06, padZ);
    scene.add(padRing);
    pads.push({ pos: new THREE.Vector3(padX, 0, padZ), defId: i, def, ring: padRing });
  });

  // Lekramper i lobbyn
  for (const [dx, dz, ryaw] of [[15, 30, 0.5], [-20, -25, -2.2]]) {
    const rm = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.8 })
    );
    rm.position.set(LC.x + dx, 0.9, LC.z + dz);
    rm.rotation.set(0.22, ryaw, 0);
    rm.castShadow = true;
    scene.add(rm);
    if (ctx.world) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, ryaw, 0));
      const body = ctx.world.createRigidBody(
        ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(LC.x + dx, 0.9, LC.z + dz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      const col = ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(3, 0.175, 6).setFriction(0.5), body);
      ctx.noDmg.add(col.handle);
    }
  }

  // Anslagstavlor
  const boards = [
    makeBoard(scene, SX + 32, HZ - 34, -Math.PI / 2, 'LÅNGRACET'),
    makeBoard(scene, px0 + 12, -18, Math.PI, 'SKROTARENAN'),
    makeBoard(scene, LC.x, LC.z - 32, 0, 'SKROTDERBY'),
  ];

  // Läktare
  addStands(scene, SX, HZ + 22, 0);
  addStands(scene, AC.x, AC.z - AR - 14, Math.PI);

  // Träd — instansade, längs rakorna + i infältet + runt navet
  addTrees(ctx, scene, HX, HZ, LC);

  // Rekvisita — deterministisk placering
  const props = [];
  const conePos = [
    [17, 12], [13, -8], [-5, 18], [-15, -12], [7, 32], [19, -22],
    [-11, 28], [-21, 8], [3, -30], [11, 44], [-13, -30], [-3, 40],
  ];
  conePos.forEach(([dx, dz]) => props.push(makeProp(ctx, scene, 'kon', LC.x + dx, LC.z + dz)));
  const barrelPos = [[px0 - 4, -18], [px0 + 20, 17], [px0 - 8, 6], [px0 + 26, -16], [px0 + 24, 22], [px0 - 2, -26]];
  barrelPos.forEach(([x, z]) => props.push(makeProp(ctx, scene, 'tunna', x, z)));

  const lobby = {
    center: LC,
    pads,
    spawn(i) {
      const col = i % 4, row = Math.floor(i / 4) % 3;
      return {
        pos: new THREE.Vector3(LC.x + 33 - col * 6, 2.2, LC.z - 14 + row * 7),
        heading: Math.PI / 2,
      };
    },
  };

  // ============ BANVARIANTER — röstas fram, allt efter grindarna byts ============
  const variants = [
    { namn: 'KLASSIKERN', trafik: 7, tagPeriod: 80, meshes: [], fixed: [], props: [], boostPads: [], avoid: [] },
    { namn: 'TRAFIKKAOS', trafik: 12, tagPeriod: 48, meshes: [], fixed: [], props: [], boostPads: [], avoid: [] },
    { namn: 'RAMPFESTEN', trafik: 4, tagPeriod: 95, meshes: [], fixed: [], props: [], boostPads: [], avoid: [] },
  ];
  const vMesh = (v, m) => { scene.add(m); v.meshes.push(m); return m; };
  const vFixed = (v, x, y, z, hx, hy, hz, yaw = 0, noDmg = false, rotX = 0, rotZ = 0, frict = 0.4) => {
    const r = fixedBox(ctx, x, y, z, hx, hy, hz, yaw, noDmg, rotX, rotZ, frict);
    if (r) v.fixed.push({ body: r.body, x, y, z });
  };
  const vRefuge = (v, rx, off, len) => {
    for (let k = -len / 2; k <= len / 2; k += 8) v.avoid.push({ x: rx + k, z: HZ + off, r: 1.5 });
    vFixed(v, rx, 0.5, HZ + off, len / 2, 0.5, 0.7);
    const island = new THREE.Mesh(new THREE.BoxGeometry(len, 1, 1.4), refM);
    island.position.set(rx, 0.5, HZ + off);
    island.castShadow = true;
    vMesh(v, island);
    for (const e of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.15, 1.5), stripeMat());
      cap.position.set(rx + e * (len / 2 + 0.3), 0.57, HZ + off);
      vMesh(v, cap);
    }
  };
  const vRamp = (v, rx, off) => {
    v.avoid.push({ x: rx, z: HZ + off, r: 9 });
    const ang = 0.09; // flack nog att ta i 300 km/h — hoppet ska ALLTID funka
    vFixed(v, rx, 0.62, HZ + off, 8, 0.15, 7, 0, true, 0, -ang, 0.06);
    const rm = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.3, 14),
      new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.8 })
    );
    rm.position.set(rx, 0.62, HZ + off);
    rm.rotation.z = -ang;
    rm.castShadow = true;
    vMesh(v, rm);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 14), stripeMat());
    edge.position.set(rx - 7.8, 1.42, HZ + off);
    edge.rotation.z = -ang;
    vMesh(v, edge);
  };
  const vBoost = (v, bx, bz) => {
    v.boostPads.push({ x: bx, z: bz, hl: 5, hw: 3.2 });
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 6.4),
      new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.9 })
    );
    pad.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    pad.position.set(bx, 0.055, bz);
    vMesh(v, pad);
  };
  const vProp = (v, typ, px, pz) => {
    const p = makeProp(ctx, scene, typ, px, pz);
    p.ox = px; p.oz = pz;
    props.push(p);
    v.props.push(p);
  };

  // KLASSIKERN: blandat allt
  {
    const v = variants[0];
    for (let k = 0; k < 15; k++) {
      const rx = SX - 800 - k * 780 - hash(k) * 160;
      if (rx < SX - CONF.RACE_DIST + 400) break;
      if (Math.abs(rx - TRAIN_X) < 60) continue;
      if (FEAT_X.some(f => Math.abs(rx - (SX - f)) < 110)) continue;
      vRefuge(v, rx, (k % 3 === 2) ? (k % 2 ? 4.5 : -4.5) : 0, 24 + hash(k + 50) * 16);
    }
    for (const [km, off] of [[3.5, -11], [7.2, 11], [10.4, -11]]) vRamp(v, SX - km * 1000, off);
    for (let k = 1; k <= 10; k++) vBoost(v, SX - k * 1200 + 320, HZ + (k % 2 ? 7 : -7));
    [[2.1, [-14, -11, 12]], [4.4, [9, 13, -13]], [6.6, [-10, 15, 8]], [8.9, [12, -12, -15]]].forEach(([km, offs], ci) => {
      offs.forEach((off, i) => vProp(v, (ci + i) % 2 ? 'tunna' : 'kon', SX - km * 1000 + hash(ci * 7 + i) * 30, HZ + off));
    });
  }
  // TRAFIKKAOS: lång mittbarriär med luckor + massor av trafik (styrs via v.trafik)
  {
    const v = variants[1];
    for (let k = 0; k < 12; k++) {
      const rx = SX - 900 - k * 1000;
      if (rx < SX - CONF.RACE_DIST + 400) break;
      if (Math.abs(rx - TRAIN_X) < 90) continue;
      if (FEAT_X.some(f => Math.abs(rx - (SX - f)) < 130)) continue;
      vRefuge(v, rx, 0, 70);
    }
    for (let k = 1; k <= 5; k++) vBoost(v, SX - k * 2300 + 300, HZ - 12);
    [[5.5, [12, -13]]].forEach(([km, offs], ci) => {
      offs.forEach((off, i) => vProp(v, i % 2 ? 'tunna' : 'kon', SX - km * 1000 + hash(ci + i) * 20, HZ + off));
    });
  }
  // RAMPFESTEN: ramper + boostar överallt
  {
    const v = variants[2];
    for (let k = 0; k < 9; k++) {
      const rx = SX - 1200 - k * 1300;
      if (FEAT_X.some(f => Math.abs(rx - (SX - f)) < 110)) continue;
      vRamp(v, rx, (k % 2 ? 11 : -11));
    }
    for (let k = 1; k <= 16; k++) vBoost(v, SX - k * 780 + 150, HZ + ((k % 3) - 1) * 11);
    [[6, [0, 3]]].forEach(([km, offs], ci) => {
      offs.forEach((off, i) => vProp(v, 'tunna', SX - km * 1000 + i * 8, HZ + off));
    });
  }

  let boardCache = ['', '', ''];
  const api = {
    zones: [raceZone, derbyZone],
    lobby, props, displays, train,
    boostPads: [],
    variant: variants[0],
    activeVariantIdx: 0,
    setVariant(i) {
      i = Math.max(0, Math.min(variants.length - 1, i | 0));
      api.activeVariantIdx = i;
      api.variant = variants[i];
      api.boostPads = SHARED_BOOST.concat(variants[i].boostPads);
      api.avoid = variants[i].avoid;
      variants.forEach((v, j) => {
        const on = j === i;
        for (const m of v.meshes) m.visible = on;
        for (const f of v.fixed) f.body?.setTranslation({ x: f.x, y: on ? f.y : f.y - 500, z: f.z }, false);
        for (const p of v.props) {
          p.mesh.visible = on;
          if (p.body) {
            p.body.setTranslation({ x: p.ox, y: on ? 0.6 : -497, z: p.oz }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      });
    },
    updateBoards(tLeft, raceRunning, derbyRunning) {
      const f = fmtTime(tLeft);
      const texts = [
        raceRunning ? ['RACE PÅGÅR', 'KÖR IN & VAR MED!'] : ['NÄSTA START', f],
        derbyRunning ? ['DERBY PÅGÅR', 'TA RAMPEN IN!'] : ['NÄSTA START', f],
        ['NÄSTA START', f],
      ];
      boards.forEach((b, i) => {
        const key = texts[i].join('|');
        if (boardCache[i] !== key) { boardCache[i] = key; b.set(texts[i][0], texts[i][1]); }
      });
    },
    updateVisuals(dt, t) {
      displays.forEach((d, i) => { d.group.rotation.y = t * 0.5 + i; });
      pads.forEach((p, i) => {
        p.ring.material.opacity = 0.45 + 0.3 * Math.sin(t * 3 + i);
      });
      // Ledfyrar pulserar, pilarna "springer" mot fållan
      const pulse = 0.14 + 0.1 * (1 + Math.sin(t * 2.2));
      for (const b of beacons) b.opacity = pulse;
      chevrons.forEach((c, i) => {
        c.mat.opacity = 0.2 + 0.7 * Math.max(0, Math.sin(t * 2.6 - c.i * 0.55));
      });
      // Järnvägsljusen blinkar när tåget är på ingång
      const blink = Math.sin(t * 9) > 0;
      const trainOn = Math.abs(train.z) < 900;
      for (const lm of crossingLights) lm.emissiveIntensity = trainOn && blink ? 2.4 : 0;
    },
  };
  api.setVariant(0);
  return api;
}

function makeBeacon(scene, x, z, color) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2.0, 70, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  m.position.set(x, 35, z);
  scene.add(m);
  return m.material;
}

// Pil-spår på marken längs en polylinje
function makeChevronTrail(scene, out, pts2, n) {
  const shape = new THREE.Shape();
  shape.moveTo(-1.3, -1.1); shape.lineTo(0, 0.3); shape.lineTo(1.3, -1.1);
  shape.lineTo(1.3, -0.2); shape.lineTo(0, 1.2); shape.lineTo(-1.3, -0.2);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // ligger platt, pekar mot -z
  const lens = [0];
  for (let i = 1; i < pts2.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(pts2[i][0] - pts2[i - 1][0], pts2[i][1] - pts2[i - 1][1]));
  }
  const total = lens[lens.length - 1];
  for (let k = 0; k < n; k++) {
    const d = (k + 0.5) / n * total;
    let i = 0;
    while (i < lens.length - 2 && lens[i + 1] < d) i++;
    const t = (d - lens[i]) / Math.max(1e-6, lens[i + 1] - lens[i]);
    const x = pts2[i][0] + (pts2[i + 1][0] - pts2[i][0]) * t;
    const z = pts2[i][1] + (pts2[i + 1][1] - pts2[i][1]) * t;
    const dx = pts2[i + 1][0] - pts2[i][0], dz = pts2[i + 1][1] - pts2[i][1];
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa02e, transparent: true, opacity: 0.5, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.06, z);
    m.rotation.y = Math.atan2(-dx, -dz);
    m.scale.setScalar(1.6);
    scene.add(m);
    out.push({ mat, i: k });
  }
}

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  const m = Math.floor(t / 60), s = t % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function spawnRest(def) {
  // markens höjd under bilens origo när hjulen står i viloläge
  return def.dims.h / 2 - 0.08 + 0.29 + def.wheelR;
}

function buildDisplayCar(def) {
  const { group } = buildCarVisual(def);
  wheelAnchors(def).forEach((a, i) => {
    const { holder } = buildWheelMesh(def, i);
    holder.position.set(a.x, a.y - 0.29, a.z);
    group.add(holder);
  });
  return group;
}

// Asfaltsband med UV:er (u längs banan, v tvärs)
function buildRibbon(pts, path, width, tex) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n], p = pts[i];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const nx = -dz, nz = dx;
    pos.set([p.x + nx * width / 2, 0.03, p.z + nz * width / 2], i * 6);
    pos.set([p.x - nx * width / 2, 0.03, p.z - nz * width / 2], i * 6 + 3);
    const u = path.cum[i] / 14;
    uv.set([u, 0], i * 4);
    uv.set([u, 1], i * 4 + 2);
    const a = i * 2, b = i * 2 + 1, c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = tex.map
    ? new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughness: 1, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function addDashes(scene, dense, y) {
  const geo = new THREE.BoxGeometry(0.35, 0.03, 3.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
  const inst = new THREE.InstancedMesh(geo, mat, Math.ceil(dense.length / 2));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  let c = 0;
  for (let i = 0; i < dense.length; i += 2) {
    const a = dense[i], b = dense[(i + 1) % dense.length];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    q.setFromAxisAngle(UP, yaw);
    m.compose(new THREE.Vector3(a.x, y, a.z), q, s);
    inst.setMatrixAt(c++, m);
  }
  inst.count = c;
  scene.add(inst);
}

function segInfo(seg) {
  const dx = seg.b.x - seg.a.x, dz = seg.b.z - seg.a.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    mx: (seg.a.x + seg.b.x) / 2, mz: (seg.a.z + seg.b.z) / 2,
    nx: -dz / len, nz: dx / len, len,
    yaw: Math.atan2(dx, dz),
  };
}

function buildWalls(ctx, scene, path, width, { height, thick, skip, spacing = 10, maxLen = 70 }) {
  // VIKTIGT: öppningarna utvärderas per 10 m-steg FÖRE sammanslagning —
  // annars murar långa segment igen grindhål och kör-in-valv.
  const dense = resamplePath(path, spacing);
  const n = dense.length;
  const mats = [];
  let segIdx = 0;
  const emit = (pa, pb, side) => {
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const nx = -dz / len, nz = dx / len;
    const mx = (pa.x + pb.x) / 2, mz = (pa.z + pb.z) / 2;
    const wx = mx + nx * side * (width / 2 + thick / 2 + 0.05);
    const wz = mz + nz * side * (width / 2 + thick / 2 + 0.05);
    const yaw = Math.atan2(dx, dz);
    fixedBox(ctx, wx, height / 2, wz, thick / 2, height / 2, len / 2 + 0.3, yaw);
    mats.push({ x: wx, z: wz, yaw, len: len + 0.6, seg: segIdx++ });
  };
  for (const side of [1, -1]) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        // slå ihop kollinjära bitar inom den obrutna sträckan (max maxLen)
        let start = run[0], prev = run[0], dirx = 0, dirz = 0, len = 0;
        for (let i = 1; i < run.length; i++) {
          const p = run[i];
          const dx = p.x - prev.x, dz = p.z - prev.z;
          const dl = Math.hypot(dx, dz) || 1e-9;
          const ndx = dx / dl, ndz = dz / dl;
          if (len > 0 && (ndx * dirx + ndz * dirz < 0.9998 || len + dl > maxLen)) {
            emit(start, prev, side);
            start = prev;
            len = 0;
          }
          if (len === 0) { dirx = ndx; dirz = ndz; }
          len += dl;
          prev = p;
        }
        if (len > 0) emit(start, prev, side);
      }
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const a = dense[i], b = dense[(i + 1) % n];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dx = b.x - a.x, dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1e-9;
      const nx = -dz / dl, nz = dx / dl;
      const inward = (nx * side * mx + nz * side * mz) < 0;
      if (skip && skip({ x: mx, z: mz }, inward)) {
        flush();
      } else {
        if (!run.length) run.push(a);
        run.push(b);
      }
    }
    flush();
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const red = new THREE.Color(0xc23b2e), white = new THREE.Color(0xd8d3c8);
  mats.forEach((w, i) => {
    q.setFromAxisAngle(UP, w.yaw);
    sc.set(0.7, 2.2, w.len);
    m.compose(new THREE.Vector3(w.x, 1.1, w.z), q, sc);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, w.seg % 2 ? red : white);
  });
  inst.castShadow = true;
  scene.add(inst);
}

function addEdgeLines(scene, segs, width) {
  const geo = new THREE.BoxGeometry(0.3, 0.02, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8e4da });
  const inst = new THREE.InstancedMesh(geo, mat, segs.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let c = 0;
  for (const seg of segs) {
    const s = segInfo(seg);
    for (const side of [1, -1]) {
      q.setFromAxisAngle(UP, s.yaw);
      sc.set(1, 1, s.len);
      m.compose(new THREE.Vector3(
        s.mx + s.nx * side * (width / 2 - 0.5), 0.045,
        s.mz + s.nz * side * (width / 2 - 0.5)
      ), q, sc);
      inst.setMatrixAt(c++, m);
    }
  }
  inst.count = c;
  scene.add(inst);
}

// Röd/vita curbs i de fyra kurvorna
function addCurbs(scene, hx, hz, r, width) {
  const centers = [
    [hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2],
    [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5],
  ];
  const per = 22;
  const geo = new THREE.BoxGeometry(1.3, 0.09, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const inst = new THREE.InstancedMesh(geo, mat, centers.length * per * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const red = new THREE.Color(0xd23c2c), white = new THREE.Color(0xece8dd);
  let c = 0;
  for (const [cx, cz, a0] of centers) {
    for (let k = 0; k < per; k++) {
      const a = a0 + ((k + 0.5) / per) * (Math.PI / 2);
      for (const rr of [r - width / 2 + 0.8, r + width / 2 - 0.8]) {
        const x = cx + rr * Math.cos(a), z = cz + rr * Math.sin(a);
        const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
        q.setFromAxisAngle(UP, yaw);
        const chord = (Math.PI / 2 / per) * rr;
        sc.set(1, 1, chord + 0.1);
        m.compose(new THREE.Vector3(x, 0.045, z), q, sc);
        inst.setMatrixAt(c, m);
        inst.setColorAt(c, (k % 2) ? red : white);
        c++;
      }
    }
  }
  inst.count = c;
  scene.add(inst);
}

function addTrees(ctx, scene, hx, hz, LC) {
  const spots = [];
  for (let x = -6600; x <= 6600; x += 85) {
    spots.push([x + hash(x) * 30, hz + 42 + hash(x + 1) * 30]);
    spots.push([x + hash(x + 2) * 30, -(hz + 42 + hash(x + 3) * 30)]);
  }
  for (let x = -6200; x <= 5900; x += 240) {
    spots.push([x + hash(x + 4) * 60, -60 + hash(x + 5) * 120]);
  }
  for (let i = 0; i < 14; i++) {
    const a = hash(i + 9) * Math.PI * 2;
    spots.push([LC.x + Math.cos(a) * (70 + hash(i + 30) * 40), LC.z + Math.sin(a) * (70 + hash(i + 60) * 40)]);
  }
  const bush = PROPS.wild_rooibos_bush;
  if (bush && bush.length && bush.some(v => /_[cde]$/.test(v.name))) {
    // varianter per storlek: lättare varianter oftare (d/e ~1–3k tris, c ~4k)
    const byName = (suffix) => bush.find(v => v.name.endsWith('_' + suffix));
    const variants = ['c', 'd', 'e'].map(byName).filter(Boolean);
    const pickW = [0.2, 0.35, 0.45];
    const chunks = new Map();
    spots.forEach(([x, z], i) => {
      const r = hash(i + 700);
      let vi = 0, acc = 0;
      for (let k = 0; k < variants.length; k++) { acc += pickW[k] ?? 0.3; if (r <= acc) { vi = k; break; } vi = k; }
      const key = Math.floor(x / 1000) + '|' + vi;
      if (!chunks.has(key)) chunks.set(key, { vi, list: [] });
      chunks.get(key).list.push([x, z, i]);
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    for (const { vi, list } of chunks.values()) {
      for (const part of variants[vi].parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach(([x, z, i], k) => {
          const s = 4 + hash(i + 200) * 5;
          q.setFromAxisAngle(UP, hash(i + 300) * 6.28);
          sc.set(s, s * (0.9 + hash(i + 400) * 0.3), s);
          m.compose(pos.set(x, 0, z), q, sc);
          inst.setMatrixAt(k, m);
        });
        inst.computeBoundingSphere();
        inst.castShadow = true;
        inst.receiveShadow = true;
        scene.add(inst);
      }
    }
    return;
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6);
  const folGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkInst = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.95 }), spots.length);
  const folInst = new THREE.InstancedMesh(folGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const greens = [0x3e6b2f, 0x4a7c38, 0x54883f, 0x35602a].map(c => new THREE.Color(c));
  spots.forEach(([x, z], i) => {
    const s = 0.8 + hash(i + 200) * 0.7;
    q.setFromAxisAngle(UP, hash(i + 300) * 6);
    sc.set(s, s, s);
    m.compose(new THREE.Vector3(x, 1.3 * s, z), q, sc);
    trunkInst.setMatrixAt(i, m);
    sc.set(2.6 * s, 3.1 * s, 2.6 * s);
    m.compose(new THREE.Vector3(x, 3.6 * s, z), q, sc);
    folInst.setMatrixAt(i, m);
    folInst.setColorAt(i, greens[i % greens.length]);
  });
  trunkInst.castShadow = folInst.castShadow = true;
  scene.add(trunkInst, folInst);
}

function addArenaWallMeshes(scene, segs) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, segs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const red = new THREE.Color(0xc23b2e), white = new THREE.Color(0xd8d3c8);
  segs.forEach((w, i) => {
    q.setFromAxisAngle(UP, w.yaw);
    s.set(0.8, 3, w.segLen + 0.6);
    m.compose(new THREE.Vector3(w.x, 1.5, w.z), q, s);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, i % 2 ? red : white);
  });
  inst.castShadow = true;
  scene.add(inst);
}

function addPocketWalls(scene, walls) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x767c85, roughness: 0.8 });
  for (const [x, z, sx, sz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.6, sz), mat);
    m.position.set(x, 0.8, z);
    m.castShadow = true;
    scene.add(m);
  }
}

function makeGateRow(ctx, scene, defs, halfW) {
  const gates = [];
  const gm = stripeMat();
  for (const g of defs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 0.3, 2.4, 0.5), gm);
    mesh.position.set(g.x, 1.2, g.z);
    mesh.rotation.y = g.yaw;
    mesh.castShadow = true;
    scene.add(mesh);
    // Ljusramp: röd = stängd, grön = öppen (byts i stepGates)
    const lampM = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff3020, emissiveIntensity: 1.6 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 0.5, 0.22, 0.6), lampM);
    lamp.position.y = 1.35;
    mesh.add(lamp);
    let body = null;
    if (ctx.world) {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, g.yaw);
      body = ctx.world.createRigidBody(
        ctx.RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(g.x, 1.2, g.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      ctx.world.createCollider(
        ctx.RAPIER.ColliderDesc.cuboid(halfW - 0.15, 1.2, 0.25).setFriction(0.3).setRestitution(0.4),
        body
      );
    }
    gates.push({ mesh, body, lampM, x: g.x, z: g.z, closedY: 1.2, openY: -1.7, cur: 1.2 });
  }
  return gates;
}

export function stepGates(zone, dt) {
  for (const g of zone.gates) {
    const target = zone.gatesOpen ? g.openY : g.closedY;
    g.cur += (target - g.cur) * Math.min(1, 3.5 * dt);
    g.mesh.position.y = g.cur;
    g.body?.setNextKinematicTranslation({ x: g.x, y: g.cur, z: g.z });
    if (g.lampM) g.lampM.emissive.setHex(zone.gatesOpen ? 0x2aff5a : 0xff3020);
  }
}

function makeArch(ctx, scene, x, z, yaw, text, halfSpan = 13) {
  const pm = new THREE.MeshStandardMaterial({ color: 0xe88b1e, roughness: 0.55, metalness: 0.3 });
  const dirX = Math.sin(yaw + Math.PI / 2), dirZ = Math.cos(yaw + Math.PI / 2);
  for (const s of [-halfSpan, halfSpan]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.5, 0.6), pm);
    post.position.set(x + dirX * s, 3.25, z + dirZ * s);
    post.castShadow = true;
    scene.add(post);
    fixedBox(ctx, x + dirX * s, 3.25, z + dirZ * s, 0.3, 3.25, 0.3);
  }
  const tex = canvasTex(512, 64, (c) => {
    c.fillStyle = '#20242a'; c.fillRect(0, 0, 512, 64);
    c.fillStyle = '#ffb64d';
    c.font = 'bold 42px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 256, 34);
  });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(halfSpan * 2, 3),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  board.position.set(x, 6.6, z);
  board.rotation.y = yaw;
  scene.add(board);
}

function makeKmSign(scene, x, z, text) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a9099 })
  );
  pole.position.set(x, 1.5, z);
  scene.add(pole);
  const tex = canvasTex(128, 64, (c) => {
    c.fillStyle = '#1c4d9e'; c.fillRect(0, 0, 128, 64);
    c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(4, 4, 120, 56);
    c.fillStyle = '#fff';
    c.font = 'bold 34px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 64, 34);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.2),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  sign.position.set(x, 3.2, z);
  scene.add(sign);
}

function makeBoard(scene, x, z, yaw, title) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 4.5),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  mesh.position.set(x, 4.8, z);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 5, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x565c64 })
  );
  pole.position.set(x, 2.5, z);
  scene.add(pole);
  const api = {
    mesh,
    set(line1, line2) {
      c.fillStyle = '#171a1f'; c.fillRect(0, 0, 512, 256);
      c.strokeStyle = '#e88b1e'; c.lineWidth = 10; c.strokeRect(8, 8, 496, 240);
      c.textAlign = 'center';
      c.fillStyle = '#e88b1e'; c.font = 'bold 44px system-ui, sans-serif';
      c.fillText(title, 256, 70);
      c.fillStyle = '#ffffff'; c.font = 'bold 40px system-ui, sans-serif';
      c.fillText(line1, 256, 140);
      c.fillStyle = '#7fe37f'; c.font = 'bold 62px system-ui, sans-serif';
      c.fillText(line2, 256, 215);
      tex.needsUpdate = true;
    },
  };
  api.set('', '');
  return api;
}

function addStands(scene, x, z, yaw) {
  const g = new THREE.Group();
  const colors = [0x9c4030, 0x3f6a9c, 0x8a8f97];
  for (let r = 0; r < 3; r++) {
    const row = new THREE.Mesh(
      new THREE.BoxGeometry(36, 1.2, 2.4),
      new THREE.MeshStandardMaterial({ color: colors[r], roughness: 0.85 })
    );
    row.position.set(0, 0.6 + r * 1.2, r * 2.4);
    row.castShadow = true;
    g.add(row);
  }
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  scene.add(g);
}

function makeProp(ctx, scene, typ, x, z) {
  let mesh, body = null;
  if (typ === 'kon') {
    mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.8, 10),
      new THREE.MeshStandardMaterial({ color: 0xff7422, roughness: 0.7 })
    );
    mesh.castShadow = true;
    mesh.position.set(x, 0.4, z);
    scene.add(mesh);
    if (ctx.world) {
      body = ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.4, z));
      ctx.world.createCollider(
        ctx.RAPIER.ColliderDesc.cuboid(0.26, 0.4, 0.26).setMass(2.5).setFriction(0.6).setRestitution(0.3),
        body
      );
    }
  } else {
    const fat = PROPS[hash(x * 0.37 + z) < 0.5 ? 'Barrel_01' : 'barrel_03'] || PROPS.Barrel_01;
    if (fat && fat.length) {
      // fotoskannat oljefat, skalat till kolliderns 0.95 m och centrerat på kroppen
      mesh = new THREE.Group();
      const hgt = fat[0].size.y || 0.9;
      for (const p of fat[0].parts) {
        const pm = new THREE.Mesh(p.geo, p.mat);
        pm.scale.setScalar(0.95 / hgt);
        pm.position.y = -0.475;
        pm.castShadow = true;
        mesh.add(pm);
      }
    } else {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12),
        new THREE.MeshStandardMaterial({ color: 0x2b6fb3, roughness: 0.5, metalness: 0.4 })
      );
    }
    mesh.castShadow = true;
    mesh.position.set(x, 0.48, z);
    scene.add(mesh);
    if (ctx.world) {
      body = ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.48, z));
      ctx.world.createCollider(
        ctx.RAPIER.ColliderDesc.cylinder(0.475, 0.42).setMass(12).setFriction(0.5).setRestitution(0.35),
        body
      );
    }
  }
  return { mesh, body, typ };
}
