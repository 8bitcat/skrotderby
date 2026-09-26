// HUD + startmeny (DOM ovanpå canvasen)
import { CARS } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), loading: $('loading'),
      raceinfo: $('raceinfo'), announce: $('announce'), toasts: $('toasts'),
      speedval: $('speedval'), carname: $('carname'), healthfill: $('healthfill'),
      score: $('score'), hint: $('hint'), carselect: $('carselect'),
      startbtn: $('startbtn'), roomcode: $('roomcode'),
      namein: $('namein'), codein: $('codein'),
      bhost: $('bhost'), bjoin: $('bjoin'), bsolo: $('bsolo'),
      netstatus: $('netstatus'),
    };
    this.selectedDef = 1;
    this._announceT = null;
    setTimeout(() => this.el.hint?.classList.add('fade'), 22000);
  }

  buildMenu() {
    try { this.el.namein.value = localStorage.getItem('skrotderby_namn') || ''; } catch { /* privat läge */ }
    const wrap = this.el.carselect;
    wrap.innerHTML = '';
    CARS.forEach((def, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (i === this.selectedDef ? ' sel' : '');
      const hex = '#' + def.color.toString(16).padStart(6, '0');
      const dots = (n) => '●'.repeat(n) + '<span class="dim">' + '●'.repeat(5 - n) + '</span>';
      card.innerHTML = `
        <div class="swatch" style="background:${hex}"></div>
        <b>${def.namn}</b>
        <p>${def.besk}</p>
        <div class="stats">
          <span>Fart</span><i>${dots(def.stats.fart)}</i>
          <span>Accel.</span><i>${dots(def.stats.accel)}</i>
          <span>Grepp</span><i>${dots(def.stats.grepp)}</i>
          <span>Pansar</span><i>${dots(def.stats.pansar)}</i>
        </div>`;
      card.addEventListener('click', () => {
        this.selectedDef = i;
        wrap.querySelectorAll('.card').forEach(c => c.classList.remove('sel'));
        card.classList.add('sel');
      });
      wrap.appendChild(card);
    });
  }

  getName() {
    const n = (this.el.namein.value || '').trim().slice(0, 12) || 'Förare';
    try { localStorage.setItem('skrotderby_namn', n); } catch { /* ok */ }
    return n;
  }

  setNetStatus(text, isError = false) {
    this.el.netstatus.textContent = text;
    this.el.netstatus.className = isError ? 'err' : '';
  }

  startGame(roomCode) {
    this.el.menu.style.display = 'none';
    this.el.hud.style.display = 'block';
    if (roomCode) {
      this.el.roomcode.textContent = 'Rumskod: ' + roomCode;
      this.el.roomcode.style.display = 'block';
    }
  }

  hideLoading() { this.el.loading.style.display = 'none'; }

  toast(msg, snd) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 3600);
    setTimeout(() => d.remove(), 4100);
    return snd;
  }

  announce(msg) {
    const a = this.el.announce;
    a.textContent = msg;
    a.classList.remove('show');
    void a.offsetWidth; // starta om animationen
    a.classList.add('show');
    clearTimeout(this._announceT);
    this._announceT = setTimeout(() => a.classList.remove('show'), 2600);
  }

  update({ kmh, health01, carName, score, raceText }) {
    this.el.speedval.textContent = Math.max(0, Math.round(kmh));
    this.el.carname.textContent = carName;
    const f = Math.max(0, Math.min(1, health01));
    this.el.healthfill.style.width = (f * 100) + '%';
    this.el.healthfill.style.background = f > 0.5 ? '#6fce4e' : f > 0.25 ? '#e8b21e' : '#e23131';
    this.el.score.textContent = 'Skrotpoäng: ' + score;
    this.el.raceinfo.innerHTML = raceText;
  }

  static raceText(status, tLeft) {
    const fmt = (t) => {
      t = Math.max(0, Math.ceil(t));
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    };
    if (!status) return `NÄSTA START <b>${fmt(tLeft)}</b> — ställ dig bakom grindarna, eller kör in i ett pågående lopp`;
    if (status.mode === 'race') {
      const plats = status.place > 0 ? `PLATS <b>${status.place}/${status.n}</b>` : '';
      return `🏁 VARV <b>${status.lap}/${status.laps}</b> · ${plats} <span class="dim">· sist åker fortast!</span>`;
    }
    return `💥 DERBY · <b>${status.kvar}</b> bilar kvar · ${fmt(status.t)}`;
  }
}
