# 🏁 SKROTDERBY

3D destruction-derby-racing i webbläsaren — multiplayer, full delfysik, races varje minut.

## Spela

Spelet behöver en webbserver (ES-moduler). Lokalt:

```bash
cd D:\GamesProjects\skrotderby
npx http-server -p 8123 -c-1
# öppna http://localhost:8123
```

Eller lägg på GitHub Pages — allt är statiska filer, biblioteken laddas från CDN.

## Så funkar det

- **Lobbyn**: du spawnar in som bil och kör runt fritt. Byt bil genom att stanna
  på en byt-platta framför podierna (eller tryck 1–6).
- **LÅNGRACET**: bana med långa raksträckor och väggar hela vägen. Ställ dig i
  depåfickan bakom grindarna — nytt race startar varje minut. Du kan också köra
  in på banan mitt i ett pågående lopp och är med direkt.
  **Catch-up:** sist i fältet får +55 % fart, ledaren inget — så klungan håller
  ihop och det knuffas hela vägen. Wipeout (snurr/tak) i race ⇒ auto-uppställning
  + comeback-turbo.
- **SKROTARENAN**: destruction derby som på PS1 — sista bilen som rullar vinner.
  Gå in via grindarna vid minutstarten, eller ta hopp-rampen i söder och flyg in
  mitt i kaoset.
- **Skador**: varenda del — stötfångare, huv, dörrar, bakvinge, t.o.m. hjulen —
  har egen hälsa, bucklar sig, hänger snett och slits till slut loss som egna
  fysikkroppar. Motorn tappar kraft med skadan. 0 hp ⇒ brand, explosion, ny bil
  i depån.

## Multiplayer

Värden äger all fysik (Rapier), gäster skickar input (30 Hz) och får
interpolerade snapshots (15 Hz) via PeerJS (WebRTC). **SKAPA SPEL** ger en
4-bokstavskod som kompisarna anger under **GÅ MED**. Bottar fyller alltid ut.

## Kontroller

| Tangent | Funktion |
|---|---|
| W/S eller ↑/↓ | Gas / broms & back |
| A/D eller ←/→ | Styr |
| Space | Handbroms (sladd!) |
| R | Vänd upp bilen |
| C | Kameraläge (nära/långt/hood) |
| M | Ljud av/på |
| 1–6 | Byt bil (utanför lopp) |

## Teknik

- **three.js** (0.160) — all grafik procedurell: lådbilar i sex stilar,
  canvas-texturer, instansade väggar, partiklar, canvas-anslagstavlor.
- **Rapier 3D** (0.12, wasm) — rigid bodies, custom raycast-fjädring per hjul
  (hjul kan slitas av ⇒ bilen hänger på tre), Δv-baserad skadedetektering.
- **PeerJS** — host-auktoritativ multiplayer, JSON-meddelanden.
- Inga byggsteg, inga assets — bara statiska filer + CDN.

## Filkarta

| Fil | Roll |
|---|---|
| `js/config.js` | Tuning + bildefinitioner |
| `js/carstyles.js` | Procedurella bilbyggen (delas host/gäst) |
| `js/vehicle.js` | Fysikbil: fjädring, däck, skador, delar som lossnar |
| `js/world.js` | Lobby, racebana, arena, grindar, tavlor, rekvisita |
| `js/race.js` | Minutstarter, join-anytime, catch-up, derby-vinnare |
| `js/ai.js` | Bottar: strosa → ställa upp → racea/ramma |
| `js/hostgame.js` | Värdens loop: fysik, skadescan, nätsnapshots |
| `js/clientgame.js` | Gästens loop: interpolering, lokal ballistik |
| `js/carview.js` | Gästens bilvy |
| `js/net.js` | PeerJS-lager |
| `js/scene.js` | Renderare + jaktkamera |
| `js/particles.js`, `js/audio.js`, `js/hud.js`, `js/input.js` | Effekter, ljud, UI, tangentbord |
