// Построитель печатной страницы 384 px: текст «ячейками» 12 px (как моноширинный битмап-шрифт 12x24),
// картинки и QR. Результат — 1-битный растр для GS v 0. На железе: тот же порядок операций,
// вместо canvas — рендер шрифта в буфер.
import { PRINTER_DOTS } from '../common/pins.js';
import { rgbaToGray, threshold, ditherFloydSteinberg, packMono } from '../common/raster.js';
import { encodeQR } from '../common/qr.js';

const CELL = 12;
const COLS = PRINTER_DOTS / CELL; // 32 символа
export const FONT_MONO = '"KossaMono", "JetBrains Mono", ui-monospace, monospace';

export class PageBuilder {
  constructor() { this.ops = []; this.y = 8; }

  line(text, { align = 'left', scale = 1, bold = false } = {}) {
    this.ops.push({ t: 'text', text: String(text), align, scale, bold, y: this.y });
    this.y += scale === 1 ? 28 : 52;
  }
  rule(ch = '-') { this.line(ch.repeat(COLS)); }
  blank(n = 12) { this.y += n; }
  image(rgba, w, h) { this.ops.push({ t: 'image', rgba, w, h, y: this.y }); this.y += h; }

  /** QR по центру: модуль = scale точек, тихая зона 2 модуля. */
  qr(text, scale = 4) {
    const q = encodeQR(text);
    const size = (q.size + 4) * scale;
    this.ops.push({ t: 'qr', q, scale, x: Math.floor((PRINTER_DOTS - size) / 2), y: this.y });
    this.y += size + 4;
  }

  height() { return this.y + 8; }

  /** @returns {{widthBytes:number,rows:number,data:Uint8Array}} */
  render(createSurface, { dither = false } = {}) {
    const h = this.height();
    const s = createSurface(PRINTER_DOTS, h);
    const ctx = s.ctx;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PRINTER_DOTS, h);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    for (const op of this.ops) {
      if (op.t === 'image') { s.drawImageRGBA({ width: op.w, height: op.h, rgba: op.rgba }, 0, op.y, op.w, op.h); continue; }
      if (op.t === 'qr') {
        ctx.fillStyle = '#000';
        const o = 2 * op.scale;
        for (let y = 0; y < op.q.size; y++) for (let x = 0; x < op.q.size; x++) {
          if (op.q.isDark(x, y)) ctx.fillRect(op.x + o + x * op.scale, op.y + o + y * op.scale, op.scale, op.scale);
        }
        continue;
      }
      const cell = CELL * op.scale;
      const cols = Math.floor(PRINTER_DOTS / cell);
      const text = op.text.slice(0, cols);
      const x0 = op.align === 'center' ? Math.floor((cols - text.length) / 2) * cell
        : op.align === 'right' ? (cols - text.length) * cell : 0;
      ctx.fillStyle = '#000';
      ctx.font = `${op.bold ? 700 : 500} ${20 * op.scale}px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      for (let i = 0; i < text.length; i++) if (text[i] !== ' ') ctx.fillText(text[i], x0 + i * cell + cell / 2, op.y);
    }
    const rgba = s.getRGBA();
    const gray = rgbaToGray(rgba, PRINTER_DOTS, h);
    const mono = dither ? ditherFloydSteinberg(gray, PRINTER_DOTS, h) : threshold(gray, PRINTER_DOTS, h, 140);
    return packMono(mono, PRINTER_DOTS, h);
  }
}

/** Строка «слева ... справа» шириной 32 символа. */
export function pair(left, right) {
  left = String(left); right = String(right).slice(0, COLS - 1);
  const maxLeft = COLS - right.length - 1;
  if (left.length > maxLeft) left = left.slice(0, maxLeft);
  return left + ' '.repeat(COLS - left.length - right.length) + right;
}

/** Тестовая страница: кириллица, ASCII, градиент, QR. */
export function buildTestPage(gradientRGBA) {
  const p = new PageBuilder();
  p.line('ТЕСТ ПЕЧАТИ', { align: 'center', scale: 2, bold: true });
  p.line('Привет, мир! Hello, world!', { align: 'center' });
  p.line('0123456789 ABCDEFGHIJKLMNOP');
  p.line('abcdefghijklmnopqrstuvwxyz');
  p.line('АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩ');
  p.rule();
  p.image(gradientRGBA, PRINTER_DOTS, 64);
  p.blank();
  p.qr('KOSSA TEST');
  p.rule('=');
  p.line('Конец теста', { align: 'center' });
  return p;
}

export function makeGradientRGBA(w = PRINTER_DOTS, h = 64) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.round((x / (w - 1)) * 255);
    const i = (y * w + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  return rgba;
}
