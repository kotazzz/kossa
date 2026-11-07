// Распиновка RP2040-Zero (см. docs/02-pinouts-wiring.md). Одни и те же номера в симуляторе и в железе.

export const PINS = Object.freeze({
  HOST_TX: 0, // UART0 TX -> Guition IO18 (RX)
  HOST_RX: 1, // UART0 RX <- Guition IO17 (TX)
  PRN_TX: 4, // UART1 TX -> принтер RX
  PRN_RX: 5, // UART1 RX <- принтер TX
  PRN_DTR: 6, // вход: DTR (busy) принтера
  ROWS: [8, 9, 10, 11, 12, 13, 14, 15], // A=8..11, B=12..15
  COLS: [26, 27, 28, 29], // общие столбцы
});

/** Уровень DTR, означающий «принтер занят». НЕ ПРОВЕРЕНО на железе — полярность сверить. */
export const DTR_BUSY_LEVEL = 1;

export const KEY_ROWS = 8;
export const KEY_COLS = 4;
export const KEY_COUNT = 32;

/** Скорости UART по умолчанию */
export const LINK_BAUD = 460800;
export const PRINTER_BAUD_DEFAULT = 115200;

/** Параметры принтера QR701 */
export const PRINTER_DOTS = 384;
export const PRINTER_WIDTH_BYTES = 48;
