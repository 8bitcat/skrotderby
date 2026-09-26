// SKROTDERBY — global konfiguration + bildefinitioner
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
  RACE_LAPS: 2,
  RACE_MAX_T: 170,
  DERBY_MAX_T: 90,
  CATCHUP: 0.55,          // sist i fältet = +55 % fart — fältet klumpar ihop sig
  COMEBACK_TURBO: 0.30,   // extra fart efter wipeout-uppställning
  COMEBACK_T: 4,

  BOTS: 8,
};

export const CARS = [
  {
    id: 'vesslan', namn: 'VESSLAN', style: 'rally',
    besk: 'Kvick liten rallyracer. Fyrhjulsdrift och bra grepp.',
    color: 0x7ac943,
    dims: { l: 3.9, w: 1.75, h: 1.3 }, mass: 900,
    power: 8600, maxKmh: 172, grip: 2.5, steerMax: 0.60, drive: 'awd',
    health: 95, wheelR: 0.33, wheelW: 0.26, spoiler: true,
    stats: { fart: 3, accel: 4, grepp: 5, pansar: 3 },
  },
  {
    id: 'muskeln', namn: 'MUSKELN', style: 'muscle',
    besk: 'Tung amerikanare med brutalt vrid. Knuffas gärna.',
    color: 0x2456e8,
    dims: { l: 4.9, w: 2.0, h: 1.25 }, mass: 1250,
    power: 12800, maxKmh: 195, grip: 2.1, steerMax: 0.52, drive: 'rwd',
    health: 115, wheelR: 0.36, wheelW: 0.30, spoiler: true,
    stats: { fart: 4, accel: 4, grepp: 3, pansar: 4 },
  },
  {
    id: 'blixten', namn: 'BLIXTEN', style: 'sport',
    besk: 'Snabbast på banan — men bräcklig som en äggkartong.',
    color: 0xe23131,
    dims: { l: 4.4, w: 1.9, h: 1.0 }, mass: 880,
    power: 11200, maxKmh: 215, grip: 2.35, steerMax: 0.55, drive: 'rwd',
    health: 70, wheelR: 0.34, wheelW: 0.28, spoiler: true,
    stats: { fart: 5, accel: 5, grepp: 4, pansar: 1 },
  },
  {
    id: 'buffeln', namn: 'BUFFELN', style: 'pickup',
    besk: 'Pickis med frontbåge. Långsam, men mosar allt i sin väg.',
    color: 0x2e5d3a,
    dims: { l: 5.1, w: 2.1, h: 1.7 }, mass: 1500,
    power: 11800, maxKmh: 150, grip: 1.9, steerMax: 0.50, drive: 'awd',
    health: 150, wheelR: 0.42, wheelW: 0.32, spoiler: false,
    stats: { fart: 2, accel: 3, grepp: 3, pansar: 5 },
  },
  {
    id: 'skroten', namn: 'SKROTEN', style: 'skrot',
    besk: 'Rostig veteran med omaka dörrar. Segare än den ser ut.',
    color: 0x8a5a33,
    dims: { l: 4.6, w: 1.85, h: 1.35 }, mass: 1050,
    power: 8000, maxKmh: 148, grip: 1.8, steerMax: 0.50, drive: 'rwd',
    health: 135, wheelR: 0.34, wheelW: 0.26, spoiler: false,
    stats: { fart: 2, accel: 2, grepp: 2, pansar: 5 },
  },
  {
    id: 'getingen', namn: 'GETINGEN', style: 'buggy',
    besk: 'Öppen buggy — blixtsnabb i svängarna, men rena äggskalet.',
    color: 0xffc21c,
    dims: { l: 3.4, w: 1.8, h: 1.1 }, mass: 620,
    power: 7900, maxKmh: 178, grip: 2.6, steerMax: 0.65, drive: 'awd',
    health: 60, wheelR: 0.38, wheelW: 0.30, spoiler: true,
    stats: { fart: 3, accel: 5, grepp: 5, pansar: 1 },
  },
];

export const BOT_NAMES = ['Bosse', 'Yngve', 'Ragnar', 'Siv', 'Kjell', 'Maud', 'Örjan', 'Gittan', 'Roffe', 'Berit', 'Sune', 'Doris'];
