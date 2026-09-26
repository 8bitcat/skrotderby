// Visuella bilbyggare — delas av värdens fysikbilar och gästernas vyer.
// Varje del som kan lossna registreras i parts[] (ordningen = bitmask-index i nätsync).
import * as THREE from 'three';

function mat(color, rough = 0.55, metal = 0.3) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
function glassMat() {
  return new THREE.MeshStandardMaterial({ color: 0x18222f, roughness: 0.15, metalness: 0.7 });
}
function shade(color, f) {
  return new THREE.Color(color).multiplyScalar(f).getHex();
}
function box(sx, sy, sz, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.castShadow = true;
  return m;
}

// Hjulankare (delas med fysiken)
export function wheelAnchors(def) {
  const { l, w, h } = def.dims;
  const wz = l / 2 - def.wheelR - 0.25;
  const wx = w / 2 - 0.06;
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
  const tireGeo = new THREE.CylinderGeometry(def.wheelR, def.wheelR, def.wheelW, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, mat(0x1b1b1b, 0.92, 0.05));
  tire.castShadow = true;
  const hubGeo = new THREE.CylinderGeometry(def.wheelR * 0.52, def.wheelR * 0.52, def.wheelW + 0.04, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, mat(0x9aa0a8, 0.4, 0.75));
  spin.add(tire, hub);
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

// Bygger hela bilens grafik. Returnerar { group, parts, bodyMeshes }.
export function buildCarVisual(def) {
  const { l, w, h } = def.dims;
  const group = new THREE.Group();
  const parts = [];
  const bodyMeshes = [];
  const tough = def.health / 100;
  const C = def.color;
  const rusty = def.style === 'skrot';
  const rough = rusty ? 0.95 : 0.5;
  const metal = rusty ? 0.05 : 0.35;
  const skrotPalette = [0x777f86, 0x9b3b2e, 0x4a6a8a, shade(C, 1.1)];
  let skrotIdx = 0;
  const panelColor = () => rusty ? skrotPalette[(skrotIdx++) % skrotPalette.length] : shade(C, 0.9 + Math.random() * 0.15);

  function addBody(mesh, x, y, z) {
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
  function lights(parent, zOff, color) {
    for (const sx of [-1, 1]) {
      const li = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.13, 0.07),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 })
      );
      li.position.set(sx * w * 0.3, 0.04, zOff);
      parent.add(li);
    }
  }

  const st = def.style;
  const isBuggy = st === 'buggy';
  const isPickup = st === 'pickup';

  // --- Kaross (statisk bas) ---
  const karossW = isBuggy ? w * 0.78 : w * 0.96;
  addBody(box(karossW, h * 0.5, l * 0.94, mat(C, rough, metal)), 0, -h * 0.12, 0);

  // Kupé / vindrutor
  if (isBuggy) {
    // Rollbur av smala balkar
    const barM = mat(0x22262b, 0.6, 0.5);
    for (const [x, z] of [[-w * 0.32, -l * 0.1], [w * 0.32, -l * 0.1], [-w * 0.32, l * 0.28], [w * 0.32, l * 0.28]]) {
      addBody(box(0.07, h * 0.75, 0.07, barM), x, h * 0.28, z);
    }
    addBody(box(w * 0.68, 0.07, 0.07, barM), 0, h * 0.64, -l * 0.1);
    addBody(box(w * 0.68, 0.07, 0.07, barM), 0, h * 0.64, l * 0.28);
    addBody(box(0.07, 0.07, l * 0.4, barM), -w * 0.32, h * 0.64, l * 0.09);
    addBody(box(0.07, 0.07, l * 0.4, barM), w * 0.32, h * 0.64, l * 0.09);
  } else {
    const cabZ = isPickup ? -l * 0.14 : l * 0.03;
    const cabL = isPickup ? l * 0.3 : l * 0.42;
    addBody(box(w * 0.8, h * 0.42, cabL, glassMat()), 0, h * 0.28, cabZ);
  }

  // Grill
  addBody(box(w * 0.5, h * 0.16, 0.07, mat(0x14171b, 0.7, 0.4)), 0, -h * 0.1, -(l * 0.47));

  // --- Lossningsbara delar (ordningen här = nätets bitmask!) ---

  // Stötfångare fram + strålkastare
  const fb = box(w + 0.08, h * 0.2, 0.26, mat(rusty ? 0x5a5f66 : shade(C, 0.55), rough, 0.5));
  lights(fb, -0.15, 0xfff3c4);
  addPart('stotfangareFram', fb, 0, -h * 0.22, -(l * 0.5 + 0.1), w + 0.08, h * 0.2, 0.3, 24);

  // Stötfångare bak + baklyktor
  const rb = box(w + 0.08, h * 0.2, 0.26, mat(rusty ? 0x5a5f66 : shade(C, 0.55), rough, 0.5));
  lights(rb, 0.15, 0xff3b30);
  addPart('stotfangareBak', rb, 0, -h * 0.22, l * 0.5 + 0.1, w + 0.08, h * 0.2, 0.3, 24);

  // Motorhuv
  addPart('huv', box(w * 0.84, 0.09, l * 0.24, mat(panelColor(), rough, metal)),
    0, h * 0.16, -(l * 0.3), w * 0.84, 0.1, l * 0.24, 30);

  if (isPickup) {
    // Flak: sidor + baklem
    const fm = () => mat(shade(C, 0.8), rough, metal);
    addPart('flakV', box(0.08, h * 0.3, l * 0.4, fm()), -(w * 0.46), h * 0.1, l * 0.26, 0.1, h * 0.3, l * 0.4, 26);
    addPart('flakH', box(0.08, h * 0.3, l * 0.4, fm()), w * 0.46, h * 0.1, l * 0.26, 0.1, h * 0.3, l * 0.4, 26);
    addPart('baklem', box(w * 0.86, h * 0.28, 0.08, fm()), 0, h * 0.08, l * 0.46, w * 0.86, h * 0.28, 0.1, 22);
    // Frontbåge (bullbar)
    const bull = new THREE.Group();
    const bm = mat(0x2a2e33, 0.5, 0.6);
    const b1 = box(w * 0.8, 0.1, 0.1, bm); b1.position.set(0, 0.12, 0);
    const b2 = box(w * 0.8, 0.1, 0.1, bm); b2.position.set(0, -0.14, 0);
    const b3 = box(0.1, h * 0.42, 0.1, bm); b3.position.set(-w * 0.26, 0, 0);
    const b4 = box(0.1, h * 0.42, 0.1, bm); b4.position.set(w * 0.26, 0, 0);
    bull.add(b1, b2, b3, b4);
    addPart('frontbage', bull, 0, -h * 0.08, -(l * 0.5 + 0.28), w * 0.8, h * 0.42, 0.14, 44);
  } else if (!isBuggy) {
    addPart('bagagelucka', box(w * 0.84, 0.09, l * 0.17, mat(panelColor(), rough, metal)),
      0, h * 0.16, l * 0.34, w * 0.84, 0.1, l * 0.17, 26);
  }

  if (!isBuggy) {
    // Dörrar
    addPart('dorrV', box(0.08, h * 0.36, l * 0.28, mat(panelColor(), rough, metal)),
      -(w * 0.5 + 0.02), -h * 0.03, l * 0.01, 0.1, h * 0.36, l * 0.28, 32);
    addPart('dorrH', box(0.08, h * 0.36, l * 0.28, mat(panelColor(), rough, metal)),
      w * 0.5 + 0.02, -h * 0.03, l * 0.01, 0.1, h * 0.36, l * 0.28, 32);
    // Tak
    if (!isPickup) {
      addPart('tak', box(w * 0.72, 0.08, l * 0.34, mat(shade(C, 0.85), rough, metal)),
        0, h * 0.52, l * 0.03, w * 0.72, 0.1, l * 0.34, 42);
    } else {
      addPart('tak', box(w * 0.72, 0.08, l * 0.26, mat(shade(C, 0.85), rough, metal)),
        0, h * 0.52, -l * 0.14, w * 0.72, 0.1, l * 0.26, 42);
    }
  } else {
    // Buggy: små sidopaneler istället för dörrar
    addPart('panelV', box(0.07, h * 0.26, l * 0.3, mat(panelColor(), rough, metal)),
      -(w * 0.4), -h * 0.05, l * 0.05, 0.08, h * 0.26, l * 0.3, 14);
    addPart('panelH', box(0.07, h * 0.26, l * 0.3, mat(panelColor(), rough, metal)),
      w * 0.4, -h * 0.05, l * 0.05, 0.08, h * 0.26, l * 0.3, 14);
  }

  // Bakvinge
  if (def.spoiler) {
    const wing = new THREE.Group();
    const wm = mat(st === 'sport' ? 0x191d22 : shade(C, 0.7), rough, 0.5);
    const plank = box(w * (st === 'sport' ? 1.0 : 0.88), 0.06, 0.3, wm);
    plank.position.y = st === 'sport' ? 0.34 : 0.26;
    const s1 = box(0.06, plank.position.y, 0.09, wm); s1.position.set(-w * 0.3, plank.position.y / 2, 0.04);
    const s2 = box(0.06, plank.position.y, 0.09, wm); s2.position.set(w * 0.3, plank.position.y / 2, 0.04);
    wing.add(plank, s1, s2);
    addPart('bakvinge', wing, 0, h * 0.42, l * 0.43, w * 0.9, 0.4, 0.32, 16);
  }

  // Stil-detaljer
  if (st === 'muscle') {
    addPart('huvscoop', box(w * 0.28, 0.13, l * 0.15, mat(0x191d22, 0.5, 0.5)),
      0, h * 0.26, -(l * 0.28), w * 0.28, 0.13, l * 0.15, 14);
    const ex = new THREE.Group();
    const em = mat(0xb9bec6, 0.3, 0.9);
    for (const sx of [-1, 1]) {
      const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8);
      pipeGeo.rotateX(Math.PI / 2);
      const p = new THREE.Mesh(pipeGeo, em);
      p.position.set(sx * w * 0.28, 0, 0);
      ex.add(p);
    }
    addPart('avgasror', ex, 0, -h * 0.34, l * 0.48, w * 0.6, 0.14, 0.36, 10);
  }
  if (st === 'rally') {
    const ramp = new THREE.Group();
    const base = box(w * 0.55, 0.09, 0.13, mat(0x191d22, 0.6, 0.4));
    ramp.add(base);
    for (let i = -1.5; i <= 1.5; i++) {
      const li = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.07, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff3c4, emissiveIntensity: 0.9 })
      );
      li.position.set(i * w * 0.13, 0, -0.08);
      ramp.add(li);
    }
    addPart('ljusramp', ramp, 0, h * 0.6, -l * 0.02, w * 0.55, 0.1, 0.16, 12);
  }

  return { group, parts, bodyMeshes };
}
