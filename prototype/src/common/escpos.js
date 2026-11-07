// Генератор ESC/POS команд, которые использует прошивка RP2040. См. docs/03-printer-escpos.md.

export const ESC_INIT = Uint8Array.from([0x1b, 0x40]);

/** ESC d n — подача на n строк */
export const feedLines = (n) => Uint8Array.from([0x1b, 0x64, n & 0xff]);

/** ESC 7 n1 n2 n3 — параметры нагрева */
export const heatConfig = (n1, n2, n3) => Uint8Array.from([0x1b, 0x37, n1, n2, n3]);

/** GS v 0 m xL xH yL yH — заголовок растровой картинки (данные: widthBytes*rows байт) */
export function rasterHeader(widthBytes, rows, m = 0) {
  return Uint8Array.from([
    0x1d, 0x76, 0x30, m,
    widthBytes & 0xff, widthBytes >> 8,
    rows & 0xff, rows >> 8,
  ]);
}

/** Склеить несколько Uint8Array */
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** ASCII-строка в байты (не-ASCII -> '?'), для PRINT_RAW */
export function asciiBytes(s) {
  return Uint8Array.from([...s].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x3f)));
}
