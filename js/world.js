// Världsbygget v2: MEGA-raksträckan (~13 km race), navet i öster med lobby +
// skrotarena, väggar hela vägen (adaptivt sammanslagna segment), curbs,
// kantlinjer, träd, km-skyltar. Grafik alltid — kolliders bara hos värden.
import * as THREE from 'three';
import { CONF, CARS } from './config.js';
import { buildCarVisual, buildWheelMesh, wheelAnchors } from './carstyles.js';

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
function fixedBox(ctx, x, y, z, hx, hy, hz, yaw = 0, noDmg = false, rotX = 0) {
  if (!ctx.world) return null;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, yaw, 0));
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
  const { WX, WZ } = CONF.WORLD;
  const { HX, HZ, R, W } = CONF.TRACK;
  const LC = CONF.LOBBY, AC = CONF.ARENA, SX = CONF.STAGE_X, AR = 58;

  // Mark
  const grassTex = canvasTex(256, 256, (c) => {
    c.fillStyle = '#4e7c3b'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = ['#44702f', '#588a42', '#4a7736', '#618f4b'][i % 4];
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    for (let i = 0; i < 26; i++) {
      c.fillStyle = 'rgba(90,120,60,0.25)';
      c.beginPath();
      c.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 22, 0, 7);
      c.fill();
    }
  }, [WX / 5, WZ / 5]);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WX * 2, WZ * 2),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
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

  // Asfalt med spårslitage
  const asphaltTex = canvasTex(128, 64, (c) => {
    c.fillStyle = '#2b2d32'; c.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 700; i++) {
      c.fillStyle = ['#26282c', '#33363b', '#2e3036'][i % 3];
      c.fillRect(Math.random() * 128, Math.random() * 64, 1.6, 1.6);
    }
    c.fillStyle = 'rgba(16,17,20,0.4)';
    c.fillRect(0, 14, 128, 9);
    c.fillRect(0, 41, 128, 9);
  }, true);
  scene.add(buildRibbon(racePts, racePath, W, asphaltTex));

  // Mittstreck
  const dense14 = resamplePath(racePath, 14);
  addDashes(scene, dense14, 0.05);

  // Kantlinjer + väggar från sammanslagna segment
  const segs = mergedSegs(racePath, 10, 70);
  const raceWallSkip = (mid, inward) => {
    if (!inward) return false;
    if (Math.abs(mid.x - SX) < 26 && mid.z > HZ - 22) return true;        // depåöppning
    if (Math.abs(mid.x - (SX - 110)) < 14 && mid.z > HZ - 22) return true; // kör-in-valv
    return false;
  };
  buildWalls(ctx, scene, segs, W, { height: 2.2, thick: 0.7, skip: raceWallSkip });
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

  // Depåficka (öppen söderut mot lobbyn)
  fixedBox(ctx, SX - 23, 0.8, HZ - 32, 0.4, 0.8, 19.5);
  fixedBox(ctx, SX + 23, 0.8, HZ - 32, 0.4, 0.8, 19.5);
  addPocketWalls(scene, [
    [SX - 23, HZ - 32, 0.8, 39],
    [SX + 23, HZ - 32, 0.8, 39],
  ]);
  const raceGates = makeGateRow(ctx, scene, [-20, -12, -4, 4, 12, 20].map(dx => ({ x: SX + dx, z: HZ - 12.6, yaw: 0 })), 4);
  const raceGrid = [];
  for (const zz of [HZ - 44, HZ - 34, HZ - 24]) for (const dx of [-15, -5, 5, 15]) {
    raceGrid.push({ pos: new THREE.Vector3(SX + dx, 0, zz), heading: Math.PI });
  }

  const raceZone = {
    id: 'race', namn: 'LÅNGRACET', mode: 'race',
    pts: racePts, cum: racePath.cum, total: racePath.total,
    width: W, raceDist: CONF.RACE_DIST, maxT: CONF.RACE_MAX_T,
    staging: { x0: SX - 22, x1: SX + 22, z0: HZ - 52, z1: HZ - 13 },
    entry: new THREE.Vector3(SX, 0, HZ - 64),
    grid: raceGrid, gates: raceGates, gatesOpen: false, race: null, extraGateT: 0,
  };

  // ============ SKROTARENAN ============
  const dirtTex = canvasTex(128, 128, (c) => {
    c.fillStyle = '#a8875c'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = ['#9c7c52', '#b39064', '#8f7048', '#bd9a6e'][i % 4];
      c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    c.strokeStyle = 'rgba(80,60,35,0.3)';
    for (let i = 0; i < 14; i++) {
      c.beginPath();
      c.arc(64, 64, 12 + i * 4, Math.random() * 6, Math.random() * 6 + 2);
      c.stroke();
    }
  }, [3, 3]);
  const arenaFloor = new THREE.Mesh(
    new THREE.CircleGeometry(AR, 48),
    new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 })
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
    new THREE.MeshStandardMaterial({ color: 0x35383e, roughness: 0.95 })
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
  CARS.forEach((def, i) => {
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide }));
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

function buildWalls(ctx, scene, segs, width, { height, thick, skip }) {
  const mats = [];
  segs.forEach((seg, si) => {
    const s = segInfo(seg);
    for (const side of [1, -1]) {
      // inåt = mot banans mittpunkt (origo)
      const inward = (s.nx * side * s.mx + s.nz * side * s.mz) < 0;
      if (skip && skip({ x: s.mx, z: s.mz }, inward)) continue;
      const wx = s.mx + s.nx * side * (width / 2 + thick / 2 + 0.05);
      const wz = s.mz + s.nz * side * (width / 2 + thick / 2 + 0.05);
      fixedBox(ctx, wx, height / 2, wz, thick / 2, height / 2, s.len / 2 + 0.4, s.yaw);
      mats.push({ x: wx, z: wz, yaw: s.yaw, len: s.len + 0.8, seg: si });
    }
  });
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
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b6fb3, roughness: 0.5, metalness: 0.4 })
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
