// Världsbygget: lobbyplaza, LÅNGRACET (långa raksträckor med väggar hela vägen),
// SKROTARENAN (derby-skål med ramp) — grafik alltid, kolliders bara när ctx.world finns (värden).
import * as THREE from 'three';
import { CONF, CARS } from './config.js';
import { buildCarVisual, buildWheelMesh, wheelAnchors } from './carstyles.js';

const UP = new THREE.Vector3(0, 1, 0);

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

function roundedRectPath(hx, hz, r, arcSeg = 9, straightSeg = 7) {
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

// ---------- Material/textur-hjälpare ----------
function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
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
function fixedBox(ctx, x, y, z, hx, hy, hz, yaw = 0, noDmg = false, rotX = 0) {
  if (!ctx.world) return null;
  const e = new THREE.Euler(rotX, yaw, 0);
  const q = new THREE.Quaternion().setFromEuler(e);
  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
  );
  const col = ctx.world.createCollider(
    ctx.RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.4).setRestitution(0.4),
    body
  );
  if (noDmg) ctx.noDmg.add(col.handle);
  return col;
}

// ---------- Huvudbygget ----------
export function buildWorld(ctx) {
  const { scene } = ctx;
  const S = 320; // världens halvbredd

  // Mark
  const grassTex = canvasTex(128, 128, (c) => {
    c.fillStyle = '#4c7a39'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      c.fillStyle = Math.random() < 0.5 ? '#456f33' : '#548540';
      c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  }, 90);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(S * 2, S * 2),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  fixedBox(ctx, 0, -1, 0, S, 1, S, 0, true);

  // Yttervägg runt hela världen
  for (const [x, z, hx, hz] of [[0, -S + 4, S, 1], [0, S - 4, S, 1], [-S + 4, 0, 1, S], [S - 4, 0, 1, S]]) {
    fixedBox(ctx, x, 2.5, z, hx, 2.5, hz, 0, true);
  }

  // ============ LÅNGRACET ============
  const HX = 260, HZ = 170, R = 55, W = 24;
  let racePts = roundedRectPath(HX, HZ, R);
  racePts = rotateToNearest(racePts, 0, HZ);
  const racePath = makePath(racePts);

  // Banans yta
  const ribbon = buildRibbon(racePts, W, 0x33363b);
  scene.add(ribbon);

  // Mittlinje-streck
  const dense = resamplePath(racePath, 12);
  addDashes(scene, dense, 0.05);

  // Startlinje (rutigt)
  const startTex = canvasTex(128, 32, (c) => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      c.fillStyle = (x + y) % 2 ? '#e8e8e8' : '#111';
      c.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(W, 3),
    new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.9 })
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.06, HZ);
  scene.add(startLine);

  // Väggar längs hela banan — öppning vid depån och vid "kör in"-valvet
  const raceWallSkip = (mid, inward) => {
    if (!inward) return false;
    if (Math.abs(mid.x) < 26 && mid.z > 150) return true;   // depåöppning (söder)
    if (Math.abs(mid.x) < 14 && mid.z < -150) return true;  // kör-in-valv (norr)
    return false;
  };
  buildWallsAlong(ctx, scene, dense, W, { height: 2.2, thick: 0.7, skip: raceWallSkip });

  // Depåficka (bakom grindarna)
  // Öppen söderut — det är ingången från lobbyn
  fixedBox(ctx, -23, 0.8, 139, 0.4, 0.8, 19);
  fixedBox(ctx, 23, 0.8, 139, 0.4, 0.8, 19);
  addPocketWalls(scene, [
    [-23, 139, 0.8, 38, 0],
    [23, 139, 0.8, 38, 0],
  ]);

  const raceGates = makeGateRow(ctx, scene, [-20, -12, -4, 4, 12, 20].map(x => ({ x, z: 158.5, yaw: 0 })), 4);

  const raceGrid = [];
  for (const zz of [132, 140, 148]) for (const xx of [-15, -5, 5, 15]) {
    raceGrid.push({ pos: new THREE.Vector3(xx, 0, zz), heading: Math.PI });
  }

  const raceZone = {
    id: 'race', namn: 'LÅNGRACET', mode: 'race',
    pts: racePts, cum: racePath.cum, total: racePath.total,
    width: W, laps: CONF.RACE_LAPS, maxT: CONF.RACE_MAX_T,
    staging: { x0: -22, x1: 22, z0: 120, z1: 158 },
    entry: new THREE.Vector3(0, 0, 106),
    grid: raceGrid, gates: raceGates, gatesOpen: false, race: null,
  };

  // "Kör in"-valv vid norra raksträckan
  makeArch(ctx, scene, 0, -(HZ - 12), 'KÖR IN — VAR MED DIREKT');

  // ============ SKROTARENAN ============
  const AC = { x: 115, z: 0 }, AR = 58;

  const arenaFloor = new THREE.Mesh(
    new THREE.CircleGeometry(AR, 48),
    new THREE.MeshStandardMaterial({ color: 0xb08d5f, roughness: 1 })
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.set(AC.x, 0.02, AC.z);
  arenaFloor.receiveShadow = true;
  scene.add(arenaFloor);

  // Ringvägg (öppning i väster för grindarna)
  const arenaSegs = 48;
  const arenaMats = [];
  for (let i = 0; i < arenaSegs; i++) {
    const a = (i / arenaSegs) * Math.PI * 2;
    const deg = ((a * 180 / Math.PI) + 360) % 360;
    if (deg > 171 && deg < 189) continue; // grindöppning västerut
    const x = AC.x + AR * Math.cos(a), z = AC.z + AR * Math.sin(a);
    const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    const segLen = (2 * Math.PI * AR) / arenaSegs;
    fixedBox(ctx, x, 1.5, z, 0.4, 1.5, segLen / 2 + 0.3, yaw);
    arenaMats.push({ x, z, yaw, segLen });
  }
  addArenaWallMeshes(scene, arenaMats);

  // Grindar + depåficka väster om arenan
  const arenaGates = makeGateRow(ctx, scene, [
    { x: AC.x - AR, z: -4.6, yaw: Math.PI / 2 },
    { x: AC.x - AR, z: 4.6, yaw: Math.PI / 2 },
  ], 4.6);
  // Öppen västerut — det är ingången från lobbyn
  fixedBox(ctx, 41.5, 0.8, -12.5, 12.5, 0.8, 0.4);
  fixedBox(ctx, 41.5, 0.8, 12.5, 12.5, 0.8, 0.4);
  addPocketWalls(scene, [
    [41.5, -12.5, 25, 0.8, 0],
    [41.5, 12.5, 25, 0.8, 0],
  ]);

  const arenaGrid = [];
  for (const xx of [34, 41, 48]) for (const zz of [-7, 0, 7]) {
    arenaGrid.push({ pos: new THREE.Vector3(xx, 0, zz), heading: -Math.PI / 2 });
  }

  // Hopp-ramp i söder — flyg in i derbyt när som helst
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
    staging: { x0: 30, x1: 54, z0: -12, z1: 12 },
    entry: new THREE.Vector3(14, 0, 0),
    grid: arenaGrid, gates: arenaGates, gatesOpen: false, race: null,
  };

  // ============ LOBBYN ============
  const LC = { x: -105, z: 0 };
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(62, 48),
    new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.95 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(LC.x, 0.02, LC.z);
  plaza.receiveShadow = true;
  scene.add(plaza);

  // Podier med visningsbilar + byt-plattor
  const pads = [];
  const displays = [];
  CARS.forEach((def, i) => {
    const ang = (2.05 + i * 0.42);
    const px = LC.x + 44 * Math.cos(ang), pz = LC.z + 44 * Math.sin(ang);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 0.5, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.8 })
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
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.7, 32),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(padX, 0.06, padZ);
    scene.add(ring);
    pads.push({ pos: new THREE.Vector3(padX, 0, padZ), defId: i, def, ring });
  });

  // Små ramper i lobbyn att leka på
  for (const [rx, rz, ryaw] of [[-90, 30, 0.5], [-125, -25, -2.2]]) {
    const rm = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.8 })
    );
    rm.position.set(rx, 0.9, rz);
    rm.rotation.set(0.22, ryaw, 0);
    rm.castShadow = true;
    scene.add(rm);
    if (ctx.world) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, ryaw, 0));
      const body = ctx.world.createRigidBody(
        ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(rx, 0.9, rz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      const col = ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(3, 0.175, 6).setFriction(0.5), body);
      ctx.noDmg.add(col.handle);
    }
  }

  // Anslagstavlor
  const boards = [
    makeBoard(scene, 30, 140, -Math.PI / 2, 'LÅNGRACET'),
    makeBoard(scene, 44, -18, Math.PI, 'SKROTARENAN'),
    makeBoard(scene, LC.x, LC.z - 32, 0, 'SKROTDERBY'),
  ];

  // Läktare (bara pynt)
  addStands(scene, 0, HZ + 22, 0);
  addStands(scene, AC.x, AC.z - AR - 14, Math.PI);

  // Rekvisita — deterministisk placering (samma på värd och gäst)
  const props = [];
  const conePos = [
    [-88, 12], [-92, -8], [-110, 18], [-120, -12], [-98, 32], [-86, -22],
    [-116, 28], [-126, 8], [-102, -30], [-94, 44], [-118, -30], [-108, 40],
  ];
  conePos.forEach(([x, z]) => props.push(makeProp(ctx, scene, 'kon', x, z)));
  const barrelPos = [[34, -18], [50, 17], [26, 6], [60, -14], [56, 22], [30, -24]];
  barrelPos.forEach(([x, z]) => props.push(makeProp(ctx, scene, 'tunna', x, z)));

  const lobby = {
    center: LC,
    pads,
    spawn(i) {
      const col = i % 4, row = Math.floor(i / 4) % 3;
      return {
        pos: new THREE.Vector3(-72 + col * 6, 2.2, -14 + row * 7),
        heading: Math.PI / 2,
      };
    },
  };

  let boardCache = ['', '', ''];
  return {
    zones: [raceZone, derbyZone],
    lobby, props, displays,
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
    },
  };
}

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  const m = Math.floor(t / 60), s = t % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function spawnRest(def) {
  return def.wheelR + (def.susRest || 0.42) * 0.7 + def.dims.h * 0.5;
}

function buildDisplayCar(def) {
  const { group } = buildCarVisual(def);
  for (const a of wheelAnchors(def)) {
    const { holder } = buildWheelMesh(def);
    holder.position.set(a.x, a.y - (def.susRest || 0.42) * 0.7 + def.wheelR * 0.3, a.z);
    group.add(holder);
  }
  return group;
}

// Banans asfaltsband
function buildRibbon(pts, width, color) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n], p = pts[i];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const nx = -dz, nz = dx;
    pos.set([p.x + nx * width / 2, 0.03, p.z + nz * width / 2], i * 6);
    pos.set([p.x - nx * width / 2, 0.03, p.z - nz * width / 2], i * 6 + 3);
    const a = i * 2, b = i * 2 + 1, c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

function addDashes(scene, dense, y) {
  const geo = new THREE.BoxGeometry(0.35, 0.03, 3);
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

// Väggar på båda sidor om banan (instansade + kolliders)
function buildWallsAlong(ctx, scene, dense, width, { height, thick, skip }) {
  const mats = [];
  const n = dense.length;
  for (let i = 0; i < n; i++) {
    const a = dense[i], b = dense[(i + 1) % n];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    // inåt = mot origo (banan omsluter mitten av kartan)
    const inwardSign = (nx * mx + nz * mz) < 0 ? 1 : -1;
    for (const side of [1, -1]) {
      const inward = side === inwardSign;
      if (skip && skip({ x: mx, z: mz }, inward)) continue;
      const wx = mx + nx * side * (width / 2 + thick / 2 + 0.05);
      const wz = mz + nz * side * (width / 2 + thick / 2 + 0.05);
      const yaw = Math.atan2(dx, dz);
      fixedBox(ctx, wx, height / 2, wz, thick / 2, height / 2, len / 2 + 0.4, yaw);
      mats.push({ x: wx, z: wz, yaw, len: len + 0.8, height, thick, seg: i });
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const red = new THREE.Color(0xc23b2e), white = new THREE.Color(0xd8d3c8);
  mats.forEach((w, i) => {
    q.setFromAxisAngle(UP, w.yaw);
    s.set(w.thick, w.height, w.len);
    m.compose(new THREE.Vector3(w.x, w.height / 2, w.z), q, s);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, w.seg % 2 ? red : white);
  });
  inst.castShadow = true;
  scene.add(inst);
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
    gates.push({ mesh, body, x: g.x, z: g.z, closedY: 1.2, openY: -1.7, cur: 1.2 });
  }
  return gates;
}

export function stepGates(zone, dt) {
  for (const g of zone.gates) {
    const target = zone.gatesOpen ? g.openY : g.closedY;
    g.cur += (target - g.cur) * Math.min(1, 3.5 * dt);
    g.mesh.position.y = g.cur;
    g.body?.setNextKinematicTranslation({ x: g.x, y: g.cur, z: g.z });
  }
}

function makeArch(ctx, scene, x, z, text) {
  const pm = new THREE.MeshStandardMaterial({ color: 0xe88b1e, roughness: 0.6 });
  for (const sx of [-13, 13]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), pm);
    post.position.set(x + sx, 3, z);
    post.castShadow = true;
    scene.add(post);
    fixedBox(ctx, x + sx, 3, z, 0.3, 3, 0.3);
  }
  const tex = canvasTex(512, 64, (c) => {
    c.fillStyle = '#20242a'; c.fillRect(0, 0, 512, 64);
    c.fillStyle = '#ffb64d';
    c.font = 'bold 40px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 256, 34);
  });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 3.2),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  board.position.set(x, 6.2, z);
  scene.add(board);
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
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b6fb3, roughness: 0.6, metalness: 0.3 })
    );
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
