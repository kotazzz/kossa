// Растровые утилиты: RGBA -> серый -> 1 бит -> упаковка для GS v 0.
// Формат: байт = 8 точек, бит 7 = самая левая, 1 = чёрная точка.

/** @returns {Float32Array} яркость 0..255 */
export function rgbaToGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // прозрачное считаем белым
    const r = rgba[i * 4] * a + 255 * (1 - a);
    const gg = rgba[i * 4 + 1] * a + 255 * (1 - a);
    const b = rgba[i * 4 + 2] * a + 255 * (1 - a);
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  return g;
}

/** Простой порог. @returns {Uint8Array} 1 = чёрный */
export function threshold(gray, w, h, level = 128) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = gray[i] < level ? 1 : 0;
  return m;
}

/** Floyd–Steinberg. @returns {Uint8Array} 1 = чёрный */
export function ditherFloydSteinberg(gray, w, h) {
  const g = Float32Array.from(gray);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const nw = old < 128 ? 0 : 255;
      m[i] = nw === 0 ? 1 : 0;
      const err = old - nw;
      if (x + 1 < w) g[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) g[i + w - 1] += (err * 3) / 16;
        g[i + w] += (err * 5) / 16;
        if (x + 1 < w) g[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return m;
}

/** Упаковка 1-битной карты в байты. @returns {{widthBytes:number, rows:number, data:Uint8Array}} */
export function packMono(mono, w, h) {
  const widthBytes = Math.ceil(w / 8);
  const data = new Uint8Array(widthBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mono[y * w + x]) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, rows: h, data };
}

/** Распаковка строки в массив 0/1. */
export function unpackRow(rowBytes, w) {
  const out = new Uint8Array(w);
  for (let x = 0; x < w; x++) out[x] = (rowBytes[x >> 3] >> (7 - (x & 7))) & 1;
  return out;
}
