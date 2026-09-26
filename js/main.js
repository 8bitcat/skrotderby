// Uppstart: meny → värd (äger fysiken, öppnar rum) eller gäst (ansluter med kod).
import { createScene, ChaseCam } from './scene.js';
import { Particles } from './particles.js';
import { AudioFx } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { HostGame } from './hostgame.js';
import { ClientGame } from './clientgame.js';
import { HostNet, ClientNet, makeCode, peerAvailable } from './net.js';

const hud = new Hud();
hud.buildMenu();

const { renderer, scene, camera, sun } = createScene();
const app = {
  renderer, scene, camera, sun,
  cam: new ChaseCam(camera),
  input: new Input(),
  hud,
  audio: new AudioFx(),
  particles: new Particles(scene),
};

let game = null;
let RAPIER = null;
let starting = false;

async function loadRapier() {
  if (RAPIER) return RAPIER;
  const mod = await import('@dimforge/rapier3d-compat');
  RAPIER = mod.default ?? mod;
  await RAPIER.init();
  return RAPIER;
}

// Förladda fysikmotorn medan menyn visas
loadRapier()
  .then(() => hud.hideLoading())
  .catch((e) => { console.error('Rapier kunde inte laddas', e); hud.hideLoading(); });

async function startHost(withNet) {
  if (starting || game) return;
  starting = true;
  app.audio.init();
  const name = hud.getName();
  const defId = hud.selectedDef;
  hud.setNetStatus('Startar …');
  try {
    await loadRapier();
  } catch {
    hud.setNetStatus('Fysikmotorn kunde inte laddas — kolla internet och ladda om.', true);
    starting = false;
    return;
  }
  let net = null, code = null;
  if (withNet && peerAvailable()) {
    code = makeCode();
    try {
      net = await HostNet.create(code);
    } catch (e) {
      console.warn('PeerJS:', e);
      hud.setNetStatus('Kunde inte skapa rum — kör vidare solo med bottar.', true);
      code = null;
    }
  } else if (withNet) {
    hud.setNetStatus('Multiplayer kräver internet — kör vidare solo med bottar.', true);
  }
  game = new HostGame(app, { RAPIER, defId, name, net });
  window.__game = game; // för felsökning/tester
  hud.startGame(code);
  starting = false;
}

async function startClient() {
  if (starting || game) return;
  const code = (hud.el.codein.value || '').trim().toUpperCase();
  if (code.length !== 4) {
    hud.setNetStatus('Skriv rumskoden — 4 bokstäver.', true);
    return;
  }
  starting = true;
  app.audio.init();
  const name = hud.getName();
  const defId = hud.selectedDef;
  hud.setNetStatus('Ansluter till ' + code + ' …');
  try {
    const net = await ClientNet.join(code);
    game = new ClientGame(app, { net, name, defId });
    hud.startGame(code);
  } catch (e) {
    hud.setNetStatus('Kunde inte ansluta: ' + (e?.message || e?.type || 'okänt fel'), true);
  }
  starting = false;
}

hud.el.bhost.addEventListener('click', () => startHost(true));
hud.el.bsolo.addEventListener('click', () => startHost(false));
hud.el.bjoin.addEventListener('click', startClient);
hud.el.codein.addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient(); });

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) game.update(dt);
  renderer.render(scene, camera);
  app.input.clearPressed();
}
requestAnimationFrame(loop);
