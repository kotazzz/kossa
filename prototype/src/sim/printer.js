// Эмулятор термопринтера QR701 (58 мм, 384 точки/строка, ESC/POS по UART).
// Моделируется: буфер приёма 4 КБ, линия DTR (busy) с гистерезисом, механическая скорость печати
// (строк/с зависит от питания), встроенный шрифт только ASCII (кириллицы нет), растр GS v 0.
import { PRINTER_WIDTH_BYTES, PRINTER_DOTS, PINS, DTR_BUSY_LEVEL } from '../common/pins.js';
import { UartPort } from './uart.js';

const W = PRINTER_WIDTH_BYTES;
const CELL_W = 12; // ширина символа встроенного шрифта (точек)
const CELL_H = 24;
const LINE_GAP = 6;
const BUF_CAP = 4096;
const BUSY_HIGH = 2048;
const BUSY_LOW = 512;

/** Бумажная лента: массив строк по 48 байт. */
export class Paper {
  constructor() { this.rows = []; this.version = 0; }
  appendRow(row) { this.rows.push(row); this.version++; }
  appendBlank(n) { for (let i = 0; i < n; i++) this.rows.push(new Uint8Array(W)); this.version++; }
  clear() { this.rows = []; this.version++; }
}

/**
 * Запасной «блочный» шрифт для тестов без canvas: непробельный символ — залитый прямоугольник.
 * В браузере подменяется на отрисовку через canvas (main.js).
 * @returns {Uint8Array[]} CELL_H*hmul строк по 48 байт
 */
export function blockFontRenderLine(text, style) {
  const wm = style.wmul, hm = style.hmul;
  const rows = [];
  for (let y = 0; y < CELL_H * hm; y++) {
    const row = new Uint8Array(W);
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ') continue;
      const x0 = i * CELL_W * wm;
      for (let x = x0 + 2; x < x0 + CELL_W * wm - 2 && x < PRINTER_DOTS; x++) {
        if (y >= 3 * hm && y < (CELL_H - 3) * hm) row[x >> 3] |= 0x80 >> (x & 7);
      }
    }
    rows.push(row);
  }
  return rows;
}

export class ThermalPrinter {
  /** @param {{baud?:number, renderLine?:Function, volts?:number}} [o] */
  constructor({ baud = 115200, renderLine = blockFontRenderLine, volts = 9 } = {}) {
    this.uart = new UartPort({ name: 'printer', baud, txCap: 64, rxCap: BUF_CAP });
    this.paper = new Paper();
    this.renderLine = renderLine;
    this.volts = volts;
    this.busy = false;
    this.outRows = []; // строки, ожидающие механической печати
    this.budget = 0;
    this.stats = { rows: 0, unknown: 0, nonAscii: 0 };
    this._reset();
  }

  /** Скорость печати, мм/с, в зависимости от питания (при 5 В медленно и бледно). */
  speedMmS() { return this.volts >= 9 ? 60 : this.volts >= 7 ? 45 : 30; }
  setVolts(v) { this.volts = v; }

  _reset() {
    this.line = '';
    this.style = { bold: false, underline: false, wmul: 1, hmul: 1, inverse: false };
    this.align = 0;
    this.raster = null;
    this.lineSpacing = LINE_GAP;
  }

  /** Уровень пина DTR для GPIO-модели. */
  dtrLevel() {
    const l = this.uart.rx.len;
    if (l >= BUSY_HIGH) this.busy = true;
    else if (l <= BUSY_LOW) this.busy = false;
    return this.busy ? DTR_BUSY_LEVEL : 1 - DTR_BUSY_LEVEL;
  }

  /** Интерфейс внешнего устройства для GpioBank. */
  drive(pin) { return pin === PINS.PRN_DTR ? this.dtrLevel() : undefined; }

  // ----- работа -----
  tick(dtMs) {
    const rowsPerMs = (this.speedMmS() * 8) / 1000; // 8 точек/мм
    this.budget = Math.min(this.budget + rowsPerMs * dtMs, 2);
    this.dtrLevel();
    for (let guard = 0; guard < 100000; guard++) if (!this._step()) break;
  }

  _emit(rows) { for (const r of rows) this.outRows.push(r); }

  _step() {
    // 1) механика: печатаем накопленные строки
    if (this.outRows.length) {
      if (this.budget < 1) return false;
      this.budget -= 1;
      this.paper.appendRow(this.outRows.shift());
      this.stats.rows++;
      return true;
    }
    const u = this.uart;
    // 2) растровые данные
    if (this.raster) {
      const r = this.raster;
      if (u.available() < r.widthBytes) return false;
      const row = new Uint8Array(W);
      const off = this.align === 1 ? (W - Math.min(r.widthBytes, W)) >> 1 : this.align === 2 ? W - Math.min(r.widthBytes, W) : 0;
      for (let i = 0; i < r.widthBytes; i++) {
        const b = u.read();
        if (off + i < W) row[off + i] = b;
      }
      this.outRows.push(row);
      if (--r.rows <= 0) this.raster = null;
      return true;
    }
    // 3) команды и текст
    const b = u.peek(0);
    if (b < 0) return false;
    if (b === 0x1b) return this._esc();
    if (b === 0x1d) return this._gs();
    u.read();
    if (b === 0x0a) { this._flushLine(); return true; }
    if (b >= 0x20) {
      let ch = String.fromCharCode(b);
      if (b >= 0x7f) { ch = '?'; this.stats.nonAscii++; } // кириллицы и прочего во встроенном шрифте нет
      const maxCols = Math.floor(PRINTER_DOTS / (CELL_W * this.style.wmul));
      if (this.line.length >= maxCols) this._flushLine();
      this.line += ch;
    }
    return true;
  }

  _flushLine() {
    const st = this.style;
    if (this.line.length === 0) {
      this._emit(Array.from({ length: CELL_H * st.hmul + this.lineSpacing }, () => new Uint8Array(W)));
    } else {
      const rows = this.renderLine(this.line, { ...st, align: this.align });
      this._emit(rows);
      this._emit(Array.from({ length: this.lineSpacing }, () => new Uint8Array(W)));
    }
    this.line = '';
  }

  _esc() {
    const u = this.uart;
    if (u.available() < 2) return false;
    const sub = u.peek(1);
    const need = { 0x40: 0, 0x61: 1, 0x45: 1, 0x64: 1, 0x4a: 1, 0x2d: 1, 0x37: 3, 0x74: 1, 0x32: 0, 0x33: 1, 0x21: 1, 0x4d: 1 }[sub];
    const total = 2 + (need ?? 0);
    if (u.available() < total) return false;
    u.read(); u.read();
    const p = Array.from({ length: need ?? 0 }, () => u.read());
    switch (sub) {
      case 0x40: this._reset(); break; // ESC @
      case 0x61: this.align = Math.min(p[0] & 3, 2); break; // ESC a n
      case 0x45: this.style.bold = (p[0] & 1) === 1; break; // ESC E n
      case 0x2d: this.style.underline = (p[0] & 3) !== 0; break; // ESC - n
      case 0x64: if (this.line) this._flushLine(); for (let i = 0; i < p[0]; i++) this._flushBlank(); break; // ESC d n
      case 0x4a: if (this.line) this._flushLine(); this._emit(Array.from({ length: p[0] }, () => new Uint8Array(W))); break; // ESC J n
      case 0x32: this.lineSpacing = LINE_GAP; break;
      case 0x33: this.lineSpacing = p[0] >> 2; break;
      case 0x37: case 0x74: case 0x21: case 0x4d: break; // нагрев, кодовая страница, режим печати: принимаем и игнорируем
      default: this.stats.unknown++;
    }
    return true;
  }

  _flushBlank() { this._emit(Array.from({ length: CELL_H + this.lineSpacing }, () => new Uint8Array(W))); }

  _gs() {
    const u = this.uart;
    if (u.available() < 2) return false;
    const sub = u.peek(1);
    if (sub === 0x76) { // GS v 0 m xL xH yL yH
      if (u.available() < 8) return false;
      if (u.peek(2) !== 0x30) { u.read(); u.read(); this.stats.unknown++; return true; }
      for (let i = 0; i < 4; i++) u.read(); // GS v 0 m
      const xL = u.read(), xH = u.read(), yL = u.read(), yH = u.read();
      if (this.line) this._flushLine();
      const widthBytes = xL | (xH << 8), rows = yL | (yH << 8);
      if (widthBytes > 0 && rows > 0) this.raster = { widthBytes, rows };
      return true;
    }
    const need = { 0x21: 1, 0x42: 1 }[sub];
    if (need === undefined) { u.read(); u.read(); this.stats.unknown++; return true; }
    if (u.available() < 2 + need) return false;
    u.read(); u.read();
    const n = u.read();
    if (sub === 0x21) { this.style.wmul = ((n >> 4) & 7) + 1; this.style.hmul = (n & 7) + 1; }
    if (sub === 0x42) this.style.inverse = (n & 1) === 1;
    return true;
  }
}
