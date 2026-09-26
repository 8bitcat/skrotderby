// SKROTDERBY — global konfiguration + bildefinitioner
// PROTO bumpas vid varje släpp: styr publika rummets namn + nätkompatibilitet.
export const PROTO = 5;
export const CONF = {
  GRAV: 13.5,
  DT: 1 / 60,

  // Skador (Δv-detektering: plötslig hastighetsändring = smäll)
  DV_MIN: 5,              // m/s ändring på ett fysiksteg innan det räknas som smäll
  DV_SCALE: 3.5,          // skadepoäng per m/s över tröskeln
  DMG_MAX: 45,            // max skada per smäll
  DMG_COOLDOWN: 0.22,     // s mellan skadetick per bil
  LAUNCH_JUICE: 1.35,     // uppåtknuff vid riktigt hårda bil-mot-bil-tacklingar

  // Lösa delar som flyger av
  LOOSE_LIFE: 9,
  MAX_LOOSE: 70,

  // Race & derby
  RACE_INTERVAL: 60,      // nytt starttillfälle varje minut
  RACE_LAPS: 1,           // ETT varv — banan är lång nog
  RACE_MAX_T: 210,
  DERBY_MAX_T: 90,
  // Avståndet till ETTAN bestämmer farten: precis bakom ledaren = samma fart
  // (klunga!), långt bak = rejält snabbare tills man är ikapp.
  CATCHUP_PER_M: 0.0045,  // +0.45 % fart per meter bakom ledaren
  CATCHUP_MAX: 0.6,       // tak: +60 %
  COMEBACK_TURBO: 0.30,   // extra fart efter wipeout-uppställning
  COMEBACK_T: 4,
  FILL_MIN: 5,            // färre deltagare än så vid start → bottar hoppar in bakifrån

  BOTS: 8,

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
  latt:  { id: 'latt',  namn: 'Lätt',  tag: '☆',  gas: 0.78, brus: 0.40, look: 0.75 },
  medel: { id: 'medel', namn: 'Medel', tag: '★',  gas: 0.90, brus: 0.15, look: 1.00 },
  svar:  { id: 'svar',  namn: 'Svår',  tag: '★★', gas: 1.00, brus: 0.04, look: 1.30 },
};

export const CARS = [
  {
    id: 'vesslan', namn: 'VESSLAN', style: 'rally',
    besk: 'Kvick liten rallyracer. Fyrhjulsdrift och bra grepp.',
    color: 0x7ac943, accent: 0xffffff, nrIdx: 0,
    dims: { l: 3.9, w: 1.75, h: 1.3 }, mass: 900,
    power: 8600, maxKmh: 172, grip: 2.5, steerMax: 0.60, drive: 'awd',
    motor: 'standard', health: 95, wheelR: 0.37, wheelW: 0.3, spoiler: true,
    stats: { fart: 3, accel: 4, grepp: 5, pansar: 3 },
  },
  {
    id: 'muskeln', namn: 'MUSKELN', style: 'muscle',
    besk: 'Tung amerikanare med brutalt vrid. Knuffas gärna.',
    color: 0x2456e8, accent: 0xf2efe8, nrIdx: 1,
    dims: { l: 4.9, w: 2.0, h: 1.25 }, mass: 1250,
    power: 12800, maxKmh: 195, grip: 2.1, steerMax: 0.52, drive: 'rwd',
    motor: 'v8', health: 115, wheelR: 0.42, wheelW: 0.34, spoiler: true,
    stats: { fart: 4, accel: 4, grepp: 3, pansar: 4 },
  },
  {
    id: 'blixten', namn: 'BLIXTEN', style: 'sport',
    besk: 'Snabbast på banan — men bräcklig som en äggkartong.',
    color: 0xe23131, accent: 0x15181d, nrIdx: 2,
    dims: { l: 4.4, w: 1.9, h: 1.0 }, mass: 880,
    power: 11200, maxKmh: 215, grip: 2.35, steerMax: 0.55, drive: 'rwd',
    motor: 'el', health: 70, wheelR: 0.38, wheelW: 0.32, spoiler: true,
    stats: { fart: 5, accel: 5, grepp: 4, pansar: 1 },
  },
  {
    id: 'buffeln', namn: 'BUFFELN', style: 'pickup',
    besk: 'Pickis med frontbåge. Långsam, men mosar allt i sin väg.',
    color: 0x2e5d3a, accent: 0xd8c8a0, nrIdx: 3,
    dims: { l: 5.1, w: 2.1, h: 1.7 }, mass: 1500,
    power: 11800, maxKmh: 150, grip: 1.9, steerMax: 0.50, drive: 'awd',
    motor: 'v8', health: 150, wheelR: 0.5, wheelW: 0.38, spoiler: false,
    stats: { fart: 2, accel: 3, grepp: 3, pansar: 5 },
  },
  {
    id: 'skroten', namn: 'SKROTEN', style: 'skrot',
    besk: 'Rostig veteran med omaka dörrar. Segare än den ser ut.',
    color: 0x8a5a33, accent: 0x9b3b2e, nrIdx: 4,
    dims: { l: 4.6, w: 1.85, h: 1.35 }, mass: 1050,
    power: 8000, maxKmh: 148, grip: 1.8, steerMax: 0.50, drive: 'rwd',
    motor: 'standard', health: 135, wheelR: 0.38, wheelW: 0.3, spoiler: false,
    stats: { fart: 2, accel: 2, grepp: 2, pansar: 5 },
  },
  {
    id: 'getingen', namn: 'GETINGEN', style: 'buggy',
    besk: 'Öppen buggy — blixtsnabb i svängarna, men rena äggskalet.',
    color: 0xffc21c, accent: 0x15181d, nrIdx: 5,
    dims: { l: 3.4, w: 1.8, h: 1.1 }, mass: 620,
    power: 7900, maxKmh: 178, grip: 2.6, steerMax: 0.65, drive: 'awd',
    motor: 'standard', health: 60, wheelR: 0.45, wheelW: 0.36, spoiler: true,
    stats: { fart: 3, accel: 5, grepp: 5, pansar: 1 },
  },
  // --- Civiltrafik (går ej att välja — VALBARA stoppar) ---
  {
    id: 'trafik1', namn: 'Volvis', style: 'skrot', civil: true,
    besk: '', color: 0xd9d6cd, accent: 0x888888, nrIdx: 0,
    dims: { l: 4.5, w: 1.8, h: 1.4 }, mass: 1150,
    power: 5200, maxKmh: 95, grip: 2.0, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 70, wheelR: 0.36, wheelW: 0.26, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 2 },
  },
  {
    id: 'trafik2', namn: 'Kombisar', style: 'skrot', civil: true,
    besk: '', color: 0xc9b795, accent: 0x888888, nrIdx: 0,
    dims: { l: 4.7, w: 1.8, h: 1.45 }, mass: 1250,
    power: 5200, maxKmh: 90, grip: 2.0, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 75, wheelR: 0.36, wheelW: 0.26, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 2 },
  },
  {
    id: 'trafik3', namn: 'Firmabilen', style: 'pickup', civil: true,
    besk: '', color: 0x9aa0a6, accent: 0x888888, nrIdx: 0,
    dims: { l: 5.0, w: 1.95, h: 1.65 }, mass: 1400,
    power: 5600, maxKmh: 92, grip: 1.9, steerMax: 0.5, drive: 'rwd',
    motor: 'standard', health: 90, wheelR: 0.42, wheelW: 0.3, spoiler: false,
    stats: { fart: 1, accel: 1, grepp: 2, pansar: 3 },
  },
];

// Banvarianter det röstas om — allt efter grindarna byts, spawn-arean består
export const BANOR = ['KLASSIKERN', 'TRAFIKKAOS', 'RAMPFESTEN'];

export const BOT_NAMES = ['Bosse', 'Yngve', 'Ragnar', 'Siv', 'Kjell', 'Maud', 'Örjan', 'Gittan', 'Roffe', 'Berit', 'Sune', 'Doris'];
