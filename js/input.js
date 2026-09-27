// Tangentbordsinput
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); });
  }

  down(code) { return this.keys.has(code); }

  // Engångstryck — konsumeras
  take(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  clearPressed() { this.pressed.clear(); }

  playerInput() {
    const th = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) +
               (this.down('KeyS') || this.down('ArrowDown') ? -1 : 0);
    const steer = (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0) +
                  (this.down('KeyD') || this.down('ArrowRight') ? -1 : 0);
    return {
      throttle: th, steer,
      handbrake: this.down('Space'),
      hop: this.down('ShiftLeft') || this.down('ShiftRight'),
    };
  }
}
