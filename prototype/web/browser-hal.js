// Браузерные реализации HAL: поверхность рисования (Canvas2D), дисплей (RGB565 + подсветка), SD-карта,
// энергонезависимая память (localStorage), загрузка шрифтов и иконок с CDN, звук, шрифт принтера.
// На железе: поверхность -> LVGL/Arduino_GFX, дисплей -> NV3041A по QSPI + PWM подсветки,
// SD -> SD_MMC, память -> LittleFS, шрифты/иконки -> ресурсы прошивки, звук -> I2S-усилитель.
import { PRINTER_DOTS, PRINTER_WIDTH_BYTES } from '../src/common/pins.js';

const LUCIDE = 'https://cdn.jsdelivr.net/npm/lucide-static@1.61.0/icons/';
const FONTSOURCE = 'https://cdn.jsdelivr.net/fontsource/fonts/';

export class CanvasSurface {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  getRGBA() { return this.ctx.getImageData(0, 0, this.width, this.height).data; }

  /** Нарисовать RGBA-картинку {width,height,rgba} масштабированной в прямоугольник. */
  drawImageRGBA(img, x, y, w, h) {
    if (!img._canvas) {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
      img._canvas = c;
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(img._canvas, x, y, w, h);
  }
}

export const createSurface = (w, h) => new CanvasSurface(w, h);

/** «Панель» NV3041A: framebuffer RGB565, подсветка (PWM) — яркость. */
export class PanelDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fb = new Uint16Array(canvas.width * canvas.height);
    this.out = this.ctx.createImageData(canvas.width, canvas.height);
    this.pending = null;
    this.frames = 0;
    this.brightness = 100;
  }

  present(surface) { this.pending = surface; }
  setBrightness(pct) { this.brightness = pct; }

  refresh() {
    if (!this.pending) return;
    const rgba = this.pending.getRGBA();
    this.pending = null;
    const n = this.fb.length;
    const k = this.brightness / 100;
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      this.fb[i] = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    }
    const o = this.out.data;
    for (let i = 0; i < n; i++) {
      const v = this.fb[i];
      const r5 = v >> 11, g6 = (v >> 5) & 63, b5 = v & 31;
      o[i * 4] = ((r5 << 3) | (r5 >> 2)) * k;
      o[i * 4 + 1] = ((g6 << 2) | (g6 >> 4)) * k;
      o[i * 4 + 2] = ((b5 << 3) | (b5 >> 2)) * k;
      o[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.out, 0, 0);
    this.frames++;
  }
}

/** Энергонезависимая память кассы (на железе — файлы LittleFS). */
export const localStorageHal = {
  load(key) {
    try { const s = localStorage.getItem('kossa:' + key); return s ? JSON.parse(s) : null; } catch { return null; }
  },
  save(key, value) { localStorage.setItem('kossa:' + key, JSON.stringify(value)); },
  clear() { Object.keys(localStorage).filter((k) => k.startsWith('kossa:')).forEach((k) => localStorage.removeItem(k)); },
};

/** Шрифты и иконки: настоящая загрузка с CDN (ошибки видны на экране загрузки). */
export function createAssets() {
  const images = new Map();
  const cache = new Map();

  async function loadFonts() {
    const faces = [];
    for (const [family, id, weights] of [['KossaUI', 'montserrat', [500, 600, 700, 800]], ['KossaMono', 'jetbrains-mono', [500, 700]]]) {
      for (const w of weights) {
        for (const [subset, range] of [['latin', 'U+0000-00FF,U+2000-206F,U+20AC,U+2116,U+2190-21FF'], ['cyrillic', 'U+0400-045F,U+0490-0491,U+04B0-04B1']]) {
          faces.push(new FontFace(family, `url(${FONTSOURCE}${id}@latest/${subset}-${w}-normal.woff2)`, { weight: String(w), unicodeRange: range }));
        }
      }
    }
    const loaded = await Promise.all(faces.map((f) => f.load()));
    loaded.forEach((f) => document.fonts.add(f));
  }

  async function loadIcons(names, onProgress) {
    let done = 0;
    const failed = [];
    await Promise.all(names.map(async (name) => {
      try {
        const res = await fetch(LUCIDE + name + '.svg');
        if (!res.ok) throw new Error(res.status);
        const svg = (await res.text()).replace(/currentColor/g, '#fff');
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        images.set(name, img);
      } catch { failed.push(name); }
      onProgress?.(++done / names.length);
    }));
    if (failed.length) throw new Error(`не загружено иконок: ${failed.length}`);
  }

  const icons = {
    draw(ctx, name, x, y, size, color) {
      const img = images.get(name);
      if (!img) return;
      const key = `${name}|${size}|${color}`;
      let c = cache.get(key);
      if (!c) {
        c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, size, size);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, size, size);
        cache.set(key, c);
      }
      ctx.drawImage(c, Math.round(x), Math.round(y));
    },
  };
  return { loadFonts, loadIcons, icons };
}

/** Звук нажатий (на железе — динамик через I2S). */
export function createBeeper() {
  let ac = null;
  addEventListener('pointerdown', () => { ac ??= new AudioContext(); }, { once: true });
  addEventListener('keydown', () => { ac ??= new AudioContext(); }, { once: true });
  return (freq, ms) => {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + ms / 1000);
  };
}

/** Виртуальная SD-карта с картинками. */
export class VirtualSd {
  constructor() { this.files = new Map(); }
  list() { return [...this.files.keys()]; }
  add(name, img) { this.files.set(name, img); }
  async loadImage(name) {
    const f = this.files.get(name);
    if (!f) throw new Error('not found');
    return f;
  }
}

function mk(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  return { width: w, height: h, rgba: g.getImageData(0, 0, w, h).data };
}

export function seedSd(sd) {
  sd.add('logo.png', mk(480, 272, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0b3d91'); bg.addColorStop(1, '#e8590c');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(120, 136, 80, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b3d91'; g.beginPath(); g.arc(120, 136, 52, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 72px sans-serif'; g.textBaseline = 'middle';
    g.fillText('КОССА', 220, 136);
  }));
  sd.add('gradient.png', mk(384, 256, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    rg.addColorStop(0, '#fff'); rg.addColorStop(0.5, '#6b7a8c'); rg.addColorStop(1, '#111');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  }));
}

/** Встроенный шрифт принтера (ASCII, ячейка 12x24) для ThermalPrinter.renderLine. */
export function makePrinterFont() {
  const cache = document.createElement('canvas');
  return function renderLine(text, style) {
    const wm = style.wmul, hm = style.hmul;
    const h = 24 * hm;
    cache.width = PRINTER_DOTS; cache.height = h;
    const g = cache.getContext('2d', { willReadFrequently: true });
    g.fillStyle = style.inverse ? '#000' : '#fff';
    g.fillRect(0, 0, PRINTER_DOTS, h);
    g.fillStyle = style.inverse ? '#fff' : '#000';
    g.textBaseline = 'top';
    g.textAlign = 'center';
    g.font = `${style.bold ? 700 : 500} 20px "KossaMono", monospace`;
    const cell = 12 * wm;
    const cols = Math.floor(PRINTER_DOTS / cell);
    const x0 = style.align === 1 ? Math.floor((cols - text.length) / 2) * cell : style.align === 2 ? (cols - text.length) * cell : 0;
    g.save();
    g.scale(wm, hm);
    for (let i = 0; i < text.length; i++) g.fillText(text[i], (x0 + i * cell) / wm + 6, 1);
    g.restore();
    if (style.underline) g.fillRect(x0, h - 3 * hm, text.length * cell, hm);
    const d = g.getImageData(0, 0, PRINTER_DOTS, h).data;
    const rows = [];
    for (let y = 0; y < h; y++) {
      const row = new Uint8Array(PRINTER_WIDTH_BYTES);
      for (let x = 0; x < PRINTER_DOTS; x++) if (d[(y * PRINTER_DOTS + x) * 4] < 140) row[x >> 3] |= 0x80 >> (x & 7);
      rows.push(row);
    }
    return rows;
  };
}
