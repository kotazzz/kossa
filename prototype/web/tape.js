// Отображение бумажной ленты принтера: рисует строки Paper в canvas, растёт по мере печати.
import { PRINTER_DOTS } from '../src/common/pins.js';

const GROW = 2000;

export class TapeView {
  /** @param {HTMLCanvasElement} canvas @param {HTMLElement} scroller @param {import('../src/sim/printer.js').Paper} paper */
  constructor(canvas, scroller, paper) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    this.scroller = scroller;
    this.setPaper(paper);
    canvas.width = PRINTER_DOTS;
    canvas.height = GROW;
    this.ctx = canvas.getContext('2d');
    this.drawn = 0;
    this.version = -1;
    this.reset();
  }

  setPaper(paper) { this.paper = paper; this.version = -1; this.drawn = 0; }

  reset() {
    this.canvas.height = GROW;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#fbfbf6';
    this.ctx.fillRect(0, 0, PRINTER_DOTS, GROW);
    this.drawn = 0;
    this.wrap.style.height = '0px';
  }

  refresh() {
    const p = this.paper;
    if (p.version === this.version) return;
    this.version = p.version;
    if (p.rows.length < this.drawn) this.reset();
    if (p.rows.length > this.canvas.height) this.grow(p.rows.length);
    const n = p.rows.length - this.drawn;
    if (n > 0) {
      const img = this.ctx.createImageData(PRINTER_DOTS, n);
      for (let r = 0; r < n; r++) {
        const row = p.rows[this.drawn + r];
        for (let x = 0; x < PRINTER_DOTS; x++) {
          const on = (row[x >> 3] >> (7 - (x & 7))) & 1;
          const i = (r * PRINTER_DOTS + x) * 4;
          const v = on ? 24 : 251;
          img.data[i] = v; img.data[i + 1] = on ? 24 : 251; img.data[i + 2] = on ? 28 : 246; img.data[i + 3] = 255;
        }
      }
      this.ctx.putImageData(img, 0, this.drawn);
      this.drawn = p.rows.length;
      this.wrap.style.height = this.drawn + 'px';
      this.scroller.scrollTop = this.scroller.scrollHeight;
    } else {
      this.wrap.style.height = this.drawn + 'px';
    }
  }

  grow(needed) {
    const newH = Math.ceil(needed / GROW) * GROW + GROW;
    const tmp = document.createElement('canvas');
    tmp.width = PRINTER_DOTS;
    tmp.height = this.canvas.height;
    tmp.getContext('2d').drawImage(this.canvas, 0, 0);
    this.canvas.height = newH;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#fbfbf6';
    this.ctx.fillRect(0, 0, PRINTER_DOTS, newH);
    this.ctx.drawImage(tmp, 0, 0);
  }

  toPNGBlobURL() {
    const c = document.createElement('canvas');
    c.width = PRINTER_DOTS;
    c.height = Math.max(1, this.drawn);
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c.toDataURL('image/png');
  }
}
