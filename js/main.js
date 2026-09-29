// Uppstart: meny → värd (äger fysiken, öppnar rum) eller gäst (ansluter med kod).
import { createScene, ChaseCam } from './scene.js?v=22';
import { Particles } from './particles.js?v=22';
import { AudioFx } from './audio.js?v=22';
import { Input } from './input.js?v=22';
import { Hud } from './hud.js?v=22';
import { HostGame } from './hostgame.js?v=22';
import { ClientGame } from './clientgame.js?v=22';
import { HostNet, ClientNet, makeCode, peerAvailable } from './net.js?v=22';
import { loadModels } from './models.js?v=22';

const hud = new Hud();
hud.buildMenu();

const { renderer, scene, camera, sun, sky, composer } = createScene();
const app = {
  renderer, scene, camera, sun, composer,
  cam: new ChaseCam(camera, sky),
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
Promise.all([loadRapier(), loadModels()])
  .then(() => hud.hideLoading())
  .catch((e) => { console.error('Laddning misslyckades', e); hud.hideLoading(); });

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
  await loadModels();
  game = new HostGame(app, { RAPIER, defId, name, net, aiNiva: hud.aiNiva });
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
    await loadModels();
    game = new ClientGame(app, { net, name, defId });
    hud.startGame(code);
  } catch (e) {
    hud.setNetStatus('Kunde inte ansluta: ' + (e?.message || e?.type || 'okänt fel'), true);
  }
  starting = false;
}

// Publik server: alla som öppnar sidan hamnar i samma värld.
// Finns ingen värd blir du värd; annars ansluter du som gäst.
// Rummet roteras per version så gamla flikar inte kan blockera nya spelare.
import { PROTO } from './config.js?v=22';
const PUBLIC_CODE = 'PUB' + PROTO;

async function startPublic() {
  if (starting || game) return;
  starting = true;
  app.audio.init();
  const name = hud.getName();
  const defId = hud.selectedDef;

  if (!peerAvailable()) {
    hud.setNetStatus('Ingen internetanslutning — kör solo med bottar.', true);
    try {
      await loadRapier();
      await loadModels();
  game = new HostGame(app, { RAPIER, defId, name, net: null, aiNiva: hud.aiNiva });
      window.__game = game;
      hud.startGame(null);
    } catch { hud.setNetStatus('Fysikmotorn kunde inte laddas.', true); }
    starting = false;
    return;
  }

  hud.setNetStatus('Letar efter den publika servern …');
  try {
    const net = await ClientNet.join(PUBLIC_CODE);
    await loadModels();
    game = new ClientGame(app, { net, name, defId, publicMode: true });
    hud.startGame(PUBLIC_CODE);
    starting = false;
    return;
  } catch { /* ingen värd ännu — vi tar värdskapet */ }

  hud.setNetStatus('Ingen värd online — du blir värd för den publika servern …');
  try {
    await loadRapier();
    const net = await HostNet.create(PUBLIC_CODE);
    await loadModels();
  game = new HostGame(app, { RAPIER, defId, name, net, aiNiva: hud.aiNiva });
    window.__game = game;
    hud.startGame(PUBLIC_CODE);
  } catch {
    // Förlorade kapplöpningen om värdskapet — någon annan hann före; anslut dit.
    try {
      const net = await ClientNet.join(PUBLIC_CODE);
      await loadModels();
    game = new ClientGame(app, { net, name, defId, publicMode: true });
      hud.startGame(PUBLIC_CODE);
    } catch (e) {
      hud.setNetStatus('Kunde inte nå publika servern (' + (e?.message || e?.type || 'okänt fel') + ') — kör solo.', true);
      try {
        await loadRapier();
        await loadModels();
  game = new HostGame(app, { RAPIER, defId, name, net: null, aiNiva: hud.aiNiva });
        window.__game = game;
        hud.startGame(null);
      } catch { hud.setNetStatus('Fysikmotorn kunde inte laddas.', true); }
    }
  }
  starting = false;
}

hud.el.bpublic.addEventListener('click', startPublic);
hud.el.bhost.addEventListener('click', () => startHost(true));

// Auto-återinträde i publika rummet efter värd-tapp (flaggan sätts före omladdning)
try {
  if (sessionStorage.getItem('skrotderby_auto') === '1') {
    sessionStorage.removeItem('skrotderby_auto');
    setTimeout(startPublic, 800);
  }
} catch { /* privat läge */ }
hud.el.bsolo.addEventListener('click', () => startHost(false));
hud.el.bjoin.addEventListener('click', startClient);
hud.el.codein.addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient(); });

// Auto-kvalitet: sjunker FPS för lågt stängs bloom av och pixelratio sänks,
// så svagare datorer slutar hacka.
let last = performance.now();
let fpsAcc = 0, fpsN = 0, lowStreak = 0, quality = 2;
function setQuality(q) {
  if (q === quality) return;
  quality = q;
  app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q >= 2 ? 1.5 : q === 1 ? 1.1 : 0.85));
  app.bloomOn = q >= 1;
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) game.update(dt);
  if (app.bloomOn === false) renderer.render(scene, camera); else composer.render();
  app.input.clearPressed();
  // FPS-mätning över 1 s
  if (dt > 0) { fpsAcc += 1 / dt; fpsN++; }
  if (fpsN >= 45) {
    const fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (fps < 40) { lowStreak++; if (lowStreak >= 2 && quality > 0) setQuality(quality - 1); }
    else if (fps > 55) { lowStreak = 0; }
  }
}
requestAnimationFrame(loop);
