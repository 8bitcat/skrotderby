// Visuella bilbyggen v2 — riktiga siluetter istället för lådor.
// Karossen extruderas ur en sidoprofil per stil, glaset är ett band som följer
// silhuetten, lacken har clearcoat och reflektioner, fälgarna har ekrar och
// varje modell bär sitt racenummer. Delas av värdens fysikbilar och gästvyer —
// parts[]-ORDNINGEN måste vara identisk överallt (nätets bitmask).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Material ----------
let _rustTex = null;
function rustTex() {
  if (_rustTex) return _rustTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#7a4d28';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 2 + Math.random() * 9;
    c.fillStyle = ['#8a5a33', '#5e3c22', '#a2603a', '#4c2f1a', '#96683f'][i % 5];
    c.globalAlpha = 0.25 + Math.random() * 0.4;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  c.globalAlpha = 1;
  _rustTex = new THREE.CanvasTexture(cv);
  _rustTex.colorSpace = THREE.SRGBColorSpace;
  _rustTex.wrapS = _rustTex.wrapT = THREE.RepeatWrapping;
  return _rustTex;
}

function paint(color, rusty = false) {
  if (rusty) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.1, map: rustTex() });
  }
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.7, roughness: 0.34, clearcoat: 0.85, clearcoatRoughness: 0.18,
  });
}
const glassMat = () => new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.6, roughness: 0.08 });
const chrome = () => new THREE.MeshStandardMaterial({ color: 0xe4e8ee, metalness: 1.0, roughness: 0.24 });
const plast = (c = 0x16191d) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.12 });

const NUMMER = [7, 22, 51, 13, 88, 5]; // racenummer per bilmodell
const _numTex = new Map();
function numberTex(n, accent) {
  const key = n + '|' + accent;
  if (_numTex.has(key)) return _numTex.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.beginPath(); c.arc(64, 64, 56, 0, 7);
  c.fillStyle = '#f2efe8'; c.fill();
  c.lineWidth = 7; c.strokeStyle = accent; c.stroke();
  c.fillStyle = '#15181d';
  c.font = '900 64px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _numTex.set(key, tex);
  return tex;
}
function numberDecal(n, accent, size = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: numberTex(n, accent), transparent: true, roughness: 0.5, metalness: 0.1 })
  );
  return m;
}

// ---------- Silhuetter (sidoprofil i [z, y], front = -l/2) ----------
function profileFor(style, l, h) {
  const F = -l / 2, B = l / 2, y0 = -h * 0.42;
  switch (style) {
    case 'sport': return [ // låg slick stocker
      [F + 0.06, y0], [F, -h * 0.14], [F + l * 0.03, -h * 0.04], [F + l * 0.16, h * 0.02],
      [F + l * 0.36, h * 0.08], [F + l * 0.48, h * 0.11], [F + l * 0.56, h * 0.3],
      [F + l * 0.64, h * 0.44], [F + l * 0.7, h * 0.47], [B - l * 0.2, h * 0.47],
      [B - l * 0.1, h * 0.38], [B - l * 0.02, h * 0.22], [B, h * 0.14], [B - 0.03, y0]];
    case 'muscle': return [ // NASCAR-stocker: lång slät nos, rakad ruta, fastback
      [F + 0.06, y0], [F, -h * 0.16], [F + l * 0.03, -h * 0.02], [F + l * 0.14, h * 0.05],
      [F + l * 0.34, h * 0.11], [F + l * 0.46, h * 0.14], [F + l * 0.54, h * 0.32],
      [F + l * 0.62, h * 0.47], [F + l * 0.68, h * 0.5], [B - l * 0.22, h * 0.5],
      [B - l * 0.12, h * 0.42], [B - l * 0.04, h * 0.26], [B, h * 0.16], [B - 0.03, y0]];
    case 'rally': return [ // kort kvick stocker
      [F + 0.06, y0], [F, -h * 0.14], [F + l * 0.04, 0], [F + l * 0.18, h * 0.07],
      [F + l * 0.36, h * 0.12], [F + l * 0.46, h * 0.15], [F + l * 0.54, h * 0.34],
      [F + l * 0.62, h * 0.49], [F + l * 0.68, h * 0.52], [B - l * 0.2, h * 0.52],
      [B - l * 0.1, h * 0.44], [B - l * 0.03, h * 0.26], [B, h * 0.16], [B - 0.03, y0]];
    case 'skrot': return [ // gammal boxig stocker
      [F + 0.06, y0], [F, -h * 0.12], [F + l * 0.03, h * 0.02], [F + l * 0.3, h * 0.1],
      [F + l * 0.42, h * 0.13], [F + l * 0.5, h * 0.36], [F + l * 0.58, h * 0.5],
      [B - l * 0.24, h * 0.5], [B - l * 0.14, h * 0.4], [B - l * 0.05, h * 0.22],
      [B, h * 0.12], [B - 0.03, y0]];
    case 'pickup': return [
      [F + 0.05, y0], [F, -h * 0.12], [F + l * 0.04, h * 0.05], [F + l * 0.26, h * 0.1],
      [F + l * 0.3, h * 0.12], [F + l * 0.38, h * 0.5], [F + l * 0.56, h * 0.5],
      [F + l * 0.58, h * 0.04], [B - 0.03, h * 0.04], [B, -h * 0.08], [B - 0.03, y0]];
    case 'buggy': return [
      [F + 0.05, y0], [F, -h * 0.12], [F + l * 0.14, h * 0.08], [F + l * 0.3, h * 0.16],
      [B - l * 0.2, h * 0.18], [B, h * 0.08], [B - 0.03, y0]];
    default: return profileFor('skrot', l, h);
  }
}

function extrudeProfile(pts, depth, material, bevel = 0.055) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// Glasband: följer silhuettens "kupolsegment" (första branta stigningen →
// sista branta fallet), stängt vid bältlinjen. Matchar alltid karossen.
function glassBand(pts, def) {
  const h = def.dims.h;
  // Kupolen = alla punkter över tröskeln (robust även för mjuka NASCAR-profiler)
  const thresh = h * 0.26;
  let i0 = -1, i1 = -1;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][1] > thresh) { i0 = Math.max(0, i - 1); break; }
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i][1] > thresh) { i1 = Math.min(pts.length - 1, i + 1); break; }
  }
  if (i0 < 0 || i1 <= i0) return null;
  const belt = h * 0.15;
  const shape = new THREE.Shape();
  shape.moveTo(pts[i0][0] + 0.05, belt);
  // +0.045 så glaset sticker ut ovanför karossens bevel och faktiskt syns
  for (let i = i0; i <= i1; i++) shape.lineTo(pts[i][0], pts[i][1] + 0.045);
  shape.lineTo(pts[i1][0] - 0.05, belt);
  shape.closePath();
  const depth = def.dims.w * 0.88 + 0.16;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, steps: 1 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, glassMat());
  mesh.castShadow = true;
  return mesh;
}

// Överytans y vid ett givet z (för att lägga huv/luckor PÅ karossen)
function profileYAt(pts, z) {
  let best = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [z1, y1] = pts[i], [z2, y2] = pts[(i + 1) % pts.length];
    if ((z >= Math.min(z1, z2)) && (z <= Math.max(z1, z2)) && Math.abs(z2 - z1) > 1e-6) {
      const t = (z - z1) / (z2 - z1);
      best = Math.max(best, y1 + (y2 - y1) * t);
    }
  }
  return best === -Infinity ? 0 : best;
}

// Taksegmentet (plattaste, högsta biten) för takskivans placering
function roofSegment(pts, h) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [z1, y1] = pts[i], [z2, y2] = pts[i + 1];
    if (Math.abs(y2 - y1) < h * 0.06 && (y1 + y2) / 2 > h * 0.3) {
      const len = Math.abs(z2 - z1);
      if (!best || len > best.len) best = { z: (z1 + z2) / 2, len, y: (y1 + y2) / 2 };
    }
  }
  return best;
}

function rbox(sx, sy, sz, material, r = 0.045) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2.5, sy / 2.5, sz / 2.5)), material);
  m.castShadow = true;
  return m;
}

// ---------- Hjulankare (delas med fysiken) ----------
export function wheelAnchors(def) {
  const { l, w, h } = def.dims;
  const wz = l / 2 - def.wheelR - 0.25;
  const wx = w / 2 - 0.02; // bred racing-spårvidd
  const wy = -h / 2 + 0.08;
  const all = def.drive === 'awd';
  return [
    { x: -wx, y: wy, z: -wz, steered: true, powered: all },
    { x: wx, y: wy, z: -wz, steered: true, powered: all },
    { x: -wx, y: wy, z: wz, steered: false, powered: true },
    { x: wx, y: wy, z: wz, steered: false, powered: true },
  ];
}

export function buildWheelMesh(def) {
  const holder = new THREE.Group();
  const spin = new THREE.Group();
  const r = def.wheelR, ww = def.wheelW;

  const tireGeo = new THREE.CylinderGeometry(r, r, ww, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, plast(0x111214));
  tire.castShadow = true;

  // Fälg: ljus heldisk + mörkt nav — chunky racing-steelie som syns på håll
  const discGeo = new THREE.CylinderGeometry(r * 0.68, r * 0.68, ww * 0.56, 18);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({
    color: def.style === 'skrot' ? 0x8f959c : 0xe4e8ee,
    metalness: 0.85, roughness: def.style === 'skrot' ? 0.55 : 0.3,
  }));
  const hubParts = [];
  const hubG = new THREE.CylinderGeometry(r * 0.2, r * 0.2, ww * 0.64, 12);
  hubG.rotateZ(Math.PI / 2);
  hubParts.push(hubG);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const lug = new THREE.CylinderGeometry(r * 0.07, r * 0.07, ww * 0.62, 6);
    lug.rotateZ(Math.PI / 2);
    lug.translate(0, Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
    hubParts.push(lug);
  }
  const hub = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(hubParts), plast(0x1d2126));

  spin.add(tire, disc, hub);
  holder.add(spin);
  return { holder, spin };
}

export function makeNameSprite(name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 36px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,0.8)';
  c.strokeText(name, 128, 34);
  c.fillStyle = '#ffffff';
  c.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.8, 0.7, 1);
  return sp;
}

// ---------- Hela bilen ----------
export function buildCarVisual(def) {
  const { l, w, h } = def.dims;
  const group = new THREE.Group();
  const parts = [];
  const bodyMeshes = [];
  const rusty = def.style === 'skrot' && !def.civil;
  const civil = !!def.civil;
  const C = def.color;
  const accent = '#' + new THREE.Color(def.accent ?? 0xffffff).getHexString();
  const nr = NUMMER[def.nrIdx ?? 0] ?? 9;
  const tough = def.health / 100;
  const skrotPalette = [0x777f86, 0x9b3b2e, 0x4a6a8a, 0x6f7d4a];
  let skrotIdx = 0;
  const panelPaint = () => rusty ? paint(skrotPalette[(skrotIdx++) % skrotPalette.length], true)
                               : paint(new THREE.Color(C).multiplyScalar(0.92 + Math.random() * 0.12).getHex());

  function addBody(mesh, x = 0, y = 0, z = 0) {
    mesh.position.set(x, y, z);
    group.add(mesh);
    bodyMeshes.push(mesh);
    return mesh;
  }
  function addPart(name, mesh, x, y, z, sx, sy, sz, health) {
    mesh.position.set(x, y, z);
    if (rusty) {
      mesh.rotation.set((Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.09);
      mesh.position.y -= 0.015;
    }
    group.add(mesh);
    parts.push({
      name, mesh,
      pos: new THREE.Vector3(x, y, z),
      size: new THREE.Vector3(sx, sy, sz),
      health: health * tough, maxHealth: health * tough,
      attached: true, drooped: false,
    });
    return mesh;
  }
  function lampor(parent, zOff, color, dim = false) {
    for (const sx of [-1, 1]) {
      const li = rbox(0.26, 0.13, 0.08, new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: dim && sx < 0 ? 0.3 : 2.0, roughness: 0.3,
      }), 0.03);
      li.position.set(sx * w * 0.3, 0.05, zOff);
      parent.add(li);
    }
  }

  const st = def.style;
  const isBuggy = st === 'buggy';
  const isPickup = st === 'pickup';
  const profile = profileFor(st, l, h);

  // Kaross + glas + underrede
  const bodyMat = paint(C, rusty);
  addBody(extrudeProfile(profile, w * 0.88, bodyMat));
  const glass = glassBand(profile, def);
  if (glass) addBody(glass);
  if (isBuggy) addBody(rbox(w * 0.6, h * 0.1, l * 0.7, plast(0x101215), 0.04), 0, -h * 0.44, 0);
  else addBody(rbox(w * 0.82, h * 0.2, l * 0.9, plast(0x101215), 0.05), 0, -h * 0.44, 0);

  // Hjulbågar + NASCAR-sidokjolar (låg racing-stance)
  const anchors = wheelAnchors(def);
  for (const a of anchors) {
    const flare = rbox(0.14, def.wheelR * 1.1, def.wheelR * 2.5, plast(0x1a1d21), 0.05);
    addBody(flare, Math.sign(a.x) * (w * 0.44 + 0.05), a.y + def.wheelR * 0.55, a.z);
  }
  if (!isBuggy && !civil) {
    for (const side of [-1, 1]) {
      addBody(rbox(0.07, h * 0.15, l * 0.52, plast(0x14171b), 0.03), side * (w * 0.46), -h * 0.38, l * 0.02);
    }
  }

  // Grill + front
  if (!isBuggy) {
    const grillCv = document.createElement('canvas');
    grillCv.width = 128; grillCv.height = 32;
    const gc = grillCv.getContext('2d');
    gc.fillStyle = '#0c0e11'; gc.fillRect(0, 0, 128, 32);
    gc.fillStyle = '#2a2f36';
    for (let y = 3; y < 32; y += 7) gc.fillRect(4, y, 120, 3);
    const gTex = new THREE.CanvasTexture(grillCv);
    gTex.colorSpace = THREE.SRGBColorSpace;
    const grill = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.52, h * 0.16),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.6, metalness: 0.4 }));
    grill.rotation.y = Math.PI;
    addBody(grill, 0, -h * 0.06, -(l / 2 + 0.005));
  }

  // Avgasrör (statiskt för alla utom muskelbilen som har det som del)
  if (st !== 'muscle') {
    const pipeGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.3, 10);
    pipeGeo.rotateX(Math.PI / 2);
    const pipe = new THREE.Mesh(pipeGeo, chrome());
    addBody(pipe, w * 0.26, -h * 0.4, l / 2 + 0.08);
  }
  // NASCAR: sidoavgasrör under kjolarna
  if (!isBuggy && !civil) {
    const sideGeo = new THREE.CylinderGeometry(0.045, 0.05, l * 0.3, 8);
    sideGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(sideGeo, chrome());
      addBody(p, side * (w * 0.47), -h * 0.44, l * 0.08);
    }
  }

  // --- Lossningsbara delar (ORDNINGEN = nätets bitmask!) ---

  // Stötfångare fram (+ litet racenummer i fronten, NASCAR-style)
  const fb = rbox(w + 0.06, h * 0.17, 0.3, rusty ? plast(0x565b62) : chrome(), 0.06);
  lampor(fb, -0.16, 0xfff4d8, rusty);
  if (!civil) {
    const fd = numberDecal(nr, accent, Math.min(0.3, h * 0.2));
    fd.rotation.y = Math.PI;
    fd.position.z = -0.16;
    fb.add(fd);
  }
  addPart('stotfangareFram', fb, 0, -h * 0.24, -(l * 0.5 + 0.12), w + 0.06, h * 0.17, 0.34, 24);

  // Stötfångare bak
  const rb2 = rbox(w + 0.06, h * 0.17, 0.3, rusty ? plast(0x565b62) : chrome(), 0.06);
  lampor(rb2, 0.16, 0xff2a20);
  addPart('stotfangareBak', rb2, 0, -h * 0.24, l * 0.5 + 0.12, w + 0.06, h * 0.17, 0.34, 24);

  // Motorhuv (med racerränder på muskelbilen) — läggs PÅ karossytan
  const hoodZ = -(l * 0.3);
  const hoodY = profileYAt(profile, hoodZ) + 0.055 + 0.03;
  const hood = rbox(w * 0.66, 0.07, l * 0.22, panelPaint(), 0.03);
  if (st === 'muscle') {
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.09, l * 0.21),
        new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.4 }));
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(sx * w * 0.09, 0.045, 0);
      hood.add(stripe);
    }
  }
  if (!civil) {
    // NASCAR-nummer även på huven
    const hd = numberDecal(nr, accent, Math.min(w * 0.4, l * 0.18));
    hd.rotation.x = -Math.PI / 2;
    hd.rotation.z = Math.PI;
    hd.position.y = 0.042;
    hood.add(hd);
  }
  addPart('huv', hood, 0, hoodY, hoodZ, w * 0.66, 0.1, l * 0.22, 30);

  if (isPickup) {
    const fm = () => paint(new THREE.Color(C).multiplyScalar(0.85).getHex(), rusty);
    addPart('flakV', rbox(0.09, h * 0.28, l * 0.38, fm(), 0.03), -(w * 0.44), h * 0.2, l * 0.24, 0.1, h * 0.28, l * 0.38, 26);
    addPart('flakH', rbox(0.09, h * 0.28, l * 0.38, fm(), 0.03), w * 0.44, h * 0.2, l * 0.24, 0.1, h * 0.28, l * 0.38, 26);
    addPart('baklem', rbox(w * 0.84, h * 0.26, 0.09, fm(), 0.03), 0, h * 0.18, l * 0.44, w * 0.84, h * 0.26, 0.1, 22);
    // Frontbåge
    const bull = new THREE.Group();
    const bm = chrome();
    const barGeo = new THREE.CylinderGeometry(0.05, 0.05, w * 0.76, 10);
    barGeo.rotateZ(Math.PI / 2);
    for (const yy of [0.12, -0.12]) {
      const b = new THREE.Mesh(barGeo.clone(), bm);
      b.position.y = yy; b.castShadow = true;
      bull.add(b);
    }
    for (const sx of [-w * 0.26, w * 0.26]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h * 0.4, 8), bm);
      p.position.set(sx, 0, 0); p.castShadow = true;
      bull.add(p);
    }
    addPart('frontbage', bull, 0, -h * 0.06, -(l * 0.5 + 0.3), w * 0.76, h * 0.4, 0.14, 44);
  } else if (!isBuggy) {
    const trunkZ = (st === 'sport' || st === 'muscle' || st === 'rally') ? l * 0.43 : l * 0.35;
    const trunkY = profileYAt(profile, trunkZ) + 0.055 + 0.03;
    addPart('bagagelucka', rbox(w * 0.66, 0.07, l * 0.15, panelPaint(), 0.03), 0, trunkY, trunkZ, w * 0.66, 0.1, l * 0.15, 26);
  }

  if (!isBuggy) {
    // Dörrar med racenummer, handtag och backspegel
    const doorZ = l * 0.02;
    for (const side of [-1, 1]) {
      const door = rbox(0.09, h * 0.4, l * 0.26, panelPaint(), 0.035);
      if (!civil) {
        // Stort NASCAR-dörrnummer
        const decal = numberDecal(nr, accent, Math.min(0.68, h * 0.46));
        decal.rotation.y = side * Math.PI / 2;
        decal.position.x = side * 0.056;
        door.add(decal);
      }
      const handle = rbox(0.03, 0.035, 0.16, chrome(), 0.01);
      handle.position.set(side * 0.06, h * 0.13, -l * 0.06);
      door.add(handle);
      const mirror = new THREE.Group();
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), plast());
      const glassM = rbox(0.05, 0.09, 0.13, chrome(), 0.01);
      glassM.position.x = side * 0.08;
      mirror.add(stalk, glassM);
      mirror.position.set(side * 0.08, h * 0.32, -l * 0.11);
      door.add(mirror);
      addPart(side < 0 ? 'dorrV' : 'dorrH', door, side * (w * 0.44 + 0.045), -h * 0.02, doorZ, 0.1, h * 0.4, l * 0.26, 32);
    }
    // Takskiva med nummer — på det verkliga taksegmentet
    const rs = roofSegment(profile, h);
    const roofZ = rs ? rs.z : l * 0.04;
    const roofL = rs ? Math.max(l * 0.1, rs.len * 0.85) : l * 0.24;
    const roofY = (rs ? rs.y : h * 0.5) + 0.045 + 0.06; // ovanpå glasbandet
    const roof = rbox(w * 0.6, 0.055, roofL, panelPaint(), 0.025);
    if (!civil) {
      const rd = numberDecal(nr, accent, Math.min(w * 0.5, roofL * 0.8));
      rd.rotation.x = -Math.PI / 2;
      rd.position.y = 0.035;
      roof.add(rd);
      // Vindrutebanderoll i accentfärg över takets framkant
      const banner = rbox(w * 0.66, 0.085, 0.12, paint(def.accent ?? 0xffffff), 0.02);
      banner.position.set(0, 0.01, -roofL / 2 - 0.02);
      roof.add(banner);
    }
    addPart('tak', roof, 0, roofY, roofZ, w * 0.6, 0.08, roofL, 42);
  } else {
    // Buggy: rollbur (statisk) + sidopaneler (delar)
    const barM = plast(0x22262b);
    const tube = (len) => {
      const g = new THREE.CylinderGeometry(0.045, 0.045, len, 8);
      return g;
    };
    for (const [x, z] of [[-w * 0.3, -l * 0.08], [w * 0.3, -l * 0.08], [-w * 0.3, l * 0.26], [w * 0.3, l * 0.26]]) {
      const post = new THREE.Mesh(tube(h * 0.78), barM);
      post.position.set(x, h * 0.3, z);
      post.castShadow = true;
      addBody(post, x, h * 0.3, z);
    }
    for (const z of [-l * 0.08, l * 0.26]) {
      const rail = new THREE.Mesh(tube(w * 0.64), barM);
      rail.rotation.z = Math.PI / 2;
      addBody(rail, 0, h * 0.66, z);
    }
    for (const x of [-w * 0.3, w * 0.3]) {
      const rail = new THREE.Mesh(tube(l * 0.36), barM);
      rail.rotation.x = Math.PI / 2;
      addBody(rail, x, h * 0.66, l * 0.09);
    }
    // Motorblock bak
    addBody(rbox(w * 0.4, h * 0.3, l * 0.16, plast(0x2c3138), 0.03), 0, h * 0.22, l * 0.36);
    for (const sx of [-1, 1]) {
      const pipeG = new THREE.CylinderGeometry(0.035, 0.045, h * 0.5, 8);
      const p = new THREE.Mesh(pipeG, chrome());
      p.rotation.x = -0.5;
      addBody(p, sx * w * 0.14, h * 0.45, l * 0.42);
    }
    for (const side of [-1, 1]) {
      const panel = rbox(0.07, h * 0.34, l * 0.42, panelPaint(), 0.03);
      const decal = numberDecal(nr, accent, h * 0.3);
      decal.rotation.y = side * Math.PI / 2;
      decal.position.x = side * 0.045;
      panel.add(decal);
      addPart(side < 0 ? 'panelV' : 'panelH', panel, side * w * 0.42, h * 0.02, l * 0.04, 0.08, h * 0.34, l * 0.42, 14);
    }
  }

  // Bakvinge med gavlar
  if (def.spoiler) {
    const wing = new THREE.Group();
    const wm = st === 'sport' ? plast(0x14171b) : paint(new THREE.Color(C).multiplyScalar(0.7).getHex(), rusty);
    const py = st === 'sport' ? 0.34 : 0.26;
    const plank = rbox(w * (st === 'sport' ? 0.98 : 0.86), 0.05, 0.3, wm, 0.02);
    plank.position.y = py;
    plank.rotation.x = -0.12;
    wing.add(plank);
    for (const sx of [-1, 1]) {
      const plate = rbox(0.04, 0.16, 0.34, wm, 0.01);
      plate.position.set(sx * w * (st === 'sport' ? 0.47 : 0.41), py, 0);
      wing.add(plate);
      const strut = rbox(0.05, py, 0.08, plast(), 0.01);
      strut.position.set(sx * w * 0.28, py / 2, 0.05);
      wing.add(strut);
    }
    addPart('bakvinge', wing, 0, h * 0.44, l * 0.44, w * 0.9, 0.42, 0.34, 16);
  }

  // Stil-krydda
  if (st === 'muscle') {
    const scoopZ = -(l * 0.28);
    const scoopY = profileYAt(profile, scoopZ) + 0.055 + 0.1;
    addPart('huvscoop', rbox(w * 0.26, 0.13, l * 0.14, plast(0x14171b), 0.03), 0, scoopY, scoopZ, w * 0.26, 0.13, l * 0.14, 14);
    const ex = new THREE.Group();
    for (const sx of [-1, 1]) {
      const pipeGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.38, 10);
      pipeGeo.rotateX(Math.PI / 2);
      const p = new THREE.Mesh(pipeGeo, chrome());
      p.position.set(sx * w * 0.28, 0, 0);
      p.castShadow = true;
      ex.add(p);
    }
    addPart('avgasror', ex, 0, -h * 0.36, l * 0.5, w * 0.6, 0.14, 0.4, 10);
  }
  if (st === 'rally') {
    const ramp = new THREE.Group();
    const base = rbox(w * 0.52, 0.09, 0.14, plast(0x14171b), 0.02);
    ramp.add(base);
    for (let i = -1.5; i <= 1.5; i++) {
      const li = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.07, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff3c4, emissiveIntensity: 1.4 })
      );
      li.position.set(i * w * 0.13, 0, -0.08);
      ramp.add(li);
    }
    addPart('ljusramp', ramp, 0, h * 0.6, -l * 0.02, w * 0.52, 0.1, 0.16, 12);
  }

  return { group, parts, bodyMeshes };
}
