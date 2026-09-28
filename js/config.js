// SKROTDERBY — global konfiguration + bildefinitioner
// PROTO bumpas vid varje släpp: styr publika rummets namn + nätkompatibilitet.
export const PROTO = 18;
export const CONF = {
  GRAV: 13.5,
  DT: 1 / 60,

  // Skador (Δv-detektering: plötslig hastighetsändring = smäll)
  DV_MIN: 5,              // m/s ändring på ett fysiksteg innan det räknas som smäll
  DV_SCALE: 3.5,          // skadepoäng per m/s över tröskeln
  DMG_MAX: 45,            // max skada per smäll
  DMG_COOLDOWN: 0.22,     // s mellan skadetick per bil
  LAUNCH_JUICE: 1.4,      // tacklingar lyfter — men tyngre bilar flyger inte lika lätt
  HALSA_MULT: 5,          // bilarna tål 5× så mycket
  HJUL_MULT: 5,           // hjulen sitter 5× hårdare
  DEL_MULT: 3,            // plåtdelar 3× (de ska fortfarande kunna lossna i rejäla smällar)
  VIKT_MULT: 1.5,         // tyngre bilar (motorkraften skalas lika → samma acceleration)

  // Lösa delar som flyger av
  LOOSE_LIFE: 9,
  MAX_LOOSE: 70,

  // Race & derby
  RACE_INTERVAL: 60,      // nytt starttillfälle varje minut
  RACE_LAPS: 1,           // ETT varv — banan är lång nog
  RACE_MAX_T: 210,
  DERBY_MAX_T: 90,
  // FARTSTEGEN: placeringen sätter toppfarten — ettan 210, tvåan 217, trean 224 …
  // ju längre bak, desto fortare, tills man är framme vid första plats.
  RACE_VMAX_BAS: 210,     // km/h för ledaren
  RACE_VMAX_STEG: 13,     // +13 km/h per placering bakåt — ledaren jagas HÅRT, segern försvaras
  RACE_POWER_STEG: 0.1,   // +10 % motorkraft per placering bakåt
  RACE_GAP_BONUS: 0.15,   // extra km/h per meter över 250 m-lucka (tak 55)
  POWER_MULT: 1.3,        // generellt kraftigare motorer — bilarna kändes sega
  COMEBACK_TURBO: 0.30,   // extra fart efter wipeout-uppställning
  COMEBACK_T: 4,
  CLOSE_AFTER_WIN: 20,     // racet stänger 20 s efter att ettan gått i mål
  RESTAGE_WAIT: 10,       // … och nästa start går 10 s efter det (≤30 s efter ettan)
  FILL_MIN: 24,           // 24 bilar i varje race — fylls på under hela loppet

  BOTS: 24,

  // Världen & banan — MEGA-raksträcka (~13 km ≈ 5 min i full gas)
  WORLD: { WX: 7150, WZ: 700 },
  TRACK: { HX: 6800, HZ: 150, R: 60, W: 40 },
  RACE_DIST: 13000,       // mål efter 13 km av södra raksträckan
  // Navet i öster där allt utgår ifrån
  LOBBY: { x: 6520, z: 0 },
  ARENA: { x: 6320, z: 0 },
  STAGE_X: 6450,          // depåfickan + startlinjen

  // Skadebalans: tacklingar ska slå ut folk, väggar straffar lagom
  DMG_CAR_MULT: 1.5,
  DMG_WALL_MULT: 0.85,

  VALBARA: 6,             // bara de första 6 bilarna går att välja (resten är trafik)
  TRAFIK_MAX: 9,          // civilbilar på banan samtidigt
  TRAIN_X_KM: 8.5,        // järnvägskorsningen ligger 8,5 km in på rakan
  BRIDGE_X_KM: 5,         // motorvägsbron
};

// AI-nivåer: gas = andel av full gas, brus = styrslarv, look = blickavstånd
export const AI_NIVAER = {
  latt:  { id: 'latt',  namn: 'Lätt',  tag: '☆',  gas: 0.86, brus: 0.3, look: 0.75 },
  medel: { id: 'medel', namn: 'Medel', tag: '★',  gas: 0.94, brus: 0.12, look: 1.00 },
  svar:  { id: 'svar',  namn: 'Svår',  tag: '★★', gas: 1.00, brus: 0.04, look: 1.30 },
};

export const CARS = [
  {
    id: 'vesslan', namn: 'VESSLAN', style: 'rally',
    besk: 'Derbybygge med störtbåge och nätfönster. Fyrhjulsdrift och bra grepp.',
    color: 0x7ac943, accent: 0xffffff, nrIdx: 0,
    dims: { l: 4.4, w: 1.75, h: 1.3 }, mass: 900,
    model: { fil: 'derbycar.glb', lack: ['Material_1404'], orig: true, fram: '-x' },
    power: 8600, maxKmh: 195, grip: 2.5, steerMax: 0.60, drive: 'awd',
    motor: 'rally', motorPitch: 1.05, health: 95, wheelR: 0.37, wheelW: 0.3, spoiler: false,
    stats: { fart: 3, accel: 4, grepp: 5, pansar: 3 },
  },
  {
    id: 'muskeln', namn: 'MUSKELN', style: 'muscle',
    besk: "'71 muskelbil med V8 och NASCAR-vinge. Knuffas gärna.",
    color: 0x2456e8, accent: 0xf2efe8, nrIdx: 1,
    dims: { l: 4.9, w: 2.0, h: 1.25 }, mass: 1250,
    model: { fil: 'muscle71.glb', lack: ['body'], orig: true },
    power: 12800, maxKmh: 220, grip: 2.1, steerMax: 0.52, drive: 'rwd',
    motor: 'v8', motorPitch: 1.0, health: 115, wheelR: 0.42, wheelW: 0.34, spoiler: true,
    stats: { fart: 4, accel: 4, grepp: 3, pansar: 4 },
  },
  {
    id: 'blixten', namn: 'BLIXTEN', style: 'sport',
    besk: "Lång och låg '73 fullsize på el — snabbast, men bräcklig.",
    color: 0xe23131, accent: 0x15181d, nrIdx: 2,
    dims: { l: 5.4, w: 1.9, h: 1.0 }, mass: 880,
    model: { fil: 'fullsize73.glb', lack: ['Chapman73_Body'], orig: true },
    power: 11200, maxKmh: 240, grip: 2.35, steerMax: 0.55, drive: 'rwd',
    motor: 'el', motorPitch: 1.0, health: 70, wheelR: 0.38, wheelW: 0.32, spoiler: false,
    stats: { fart: 5, accel: 5, grepp: 4, pansar: 1 },
  },
  {
    id: 'buffeln', namn: 'BUFFELN', style: 'pickup',
    besk: "Pickup '78 med frontbåge. Långsam, men mosar allt i sin väg.",
    color: 0x2e5d3a, accent: 0xd8c8a0, nrIdx: 3,
    dims: { l: 4.8, w: 2.1, h: 1.7 }, mass: 1500,
    model: { fil: 'pickup78.glb', lack: ['Bodycolour'], orig: true },
    power: 11800, maxKmh: 175, grip: 1.9, steerMax: 0.50, drive: 'awd',
    motor: 'v8b', motorPitch: 0.92, health: 150, wheelR: 0.5, wheelW: 0.38, spoiler: false,
    stats: { fart: 2, accel: 3, grepp: 3, pansar: 5 },
  },
  {
    id: 'skroten', namn: 'SKROTEN', style: 'skrot',
    besk: "Rostig derbycoupé '78 med störtbåge. Segare än den ser ut.",
    color: 0x8a5a33, accent: 0x9b3b2e, nrIdx: 4,
    dims: { l: 4.7, w: 1.85, h: 1.35 }, mass: 1050,
    model: { fil: 'derbycoupe78.glb', lack: ['body'], rand: ['ROLLCAGE_PAINT'], orig: true },
    power: 8000, maxKmh: 170, grip: 1.8, steerMax: 0.50, drive: 'rwd',
    motor: 'old', motorPitch: 1.0, health: 135, wheelR: 0.38, wheelW: 0.3, spoiler: false,
    stats: { fart: 2, accel: 2, grepp: 2, pansar: 5 },
  },
  {
    id: 'getingen', namn: 'GETINGEN', style: 'muscle',
    besk: "Lätt 80-talssedan — blixtsnabb i svängarna, men rena äggskalet.",
    color: 0xffc21c, accent: 0x15181d, nrIdx: 5,
    dims: { l: 5.0, w: 1.8, h: 1.1 }, mass: 620,
    model: { fil: 'sedan80s.glb', lack: ['Bodycolor'], orig: true },
    power: 7900, maxKmh: 205, grip: 2.6, steerMax: 0.65, drive: 'awd',
    motor: 'i4', motorPitch: 1.12, health: 60, wheelR: 0.45, wheelW: 0.36, spoiler: false,
    stats: { fart: 3, accel: 5, grepp: 5, pansar: 1 },
  },
  // --- Civiltrafik (går ej att välja — VALBARA stoppar) ---
  {
    id: 'trafik1', namn: 'Volvis', style: 'skrot', civil: true,
    besk: '', color: 0xd9d6cd, accent: 0x888888, nrIdx: 0,
    dims: { l: 4.9, w: 1.8, h: 1.4 }, mass: 1150,
    model: { fil: 'sedan88.glb', lack: ['Bodycolor'], orig: true },
    power: 5200, maxKmh: 95, grip: 2.0, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 70, wheelR: 0.36, wheelW: 0.26, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 2 },
  },
  {
    id: 'trafik2', namn: 'Kombisar', style: 'skrot', civil: true,
    besk: '', color: 0xc9b795, accent: 0x888888, nrIdx: 0,
    dims: { l: 4.9, w: 1.8, h: 1.45 }, mass: 1250,
    model: { fil: 'amsedan80.glb', lack: ['bodycolour'], orig: true },
    power: 5200, maxKmh: 90, grip: 2.0, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 75, wheelR: 0.36, wheelW: 0.26, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 2 },
  },
  {
    id: 'trafik3', namn: 'Firmabilen', style: 'pickup', civil: true,
    besk: '', color: 0x9aa0a6, accent: 0x888888, nrIdx: 0,
    dims: { l: 4.8, w: 1.95, h: 1.65 }, mass: 1400,
    model: { fil: 'pickup78.glb', lack: ['Bodycolour'], orig: true },
    power: 5600, maxKmh: 92, grip: 1.9, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 90, wheelR: 0.42, wheelW: 0.3, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 3 },
  },
];

// Banvarianter det röstas om — allt efter grindarna byts, spawn-arean består
export const BANOR = ['KLASSIKERN', 'TRAFIKKAOS', 'RAMPFESTEN'];

export const BOT_NAMES = ['Bosse', 'Yngve', 'Ragnar', 'Siv', 'Kjell', 'Maud', 'Örjan', 'Gittan', 'Roffe', 'Berit', 'Sune', 'Doris'];

// Tyngre bilar: massa och motorkraft skalas lika så accelerationen behålls
for (const d of CARS) { d.mass *= CONF.VIKT_MULT; d.power *= CONF.VIKT_MULT; }
