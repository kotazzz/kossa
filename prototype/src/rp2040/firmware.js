// «Прошивка» RP2040-Zero: контроллер периферии (клавиатура + принтер) между Guition и принтером.
// Это код, который переписывается на C++/Arduino-Pico почти построчно. Он знает ТОЛЬКО про HAL:
//   hal.gpio  {pinMode, digitalWrite, digitalRead}
//   hal.host  UART0 к Guition   {write, txFree, available, read, setBaud}
//   hal.prn   UART1 к принтеру  {write, txFree, available, read, setBaud}
//   hal.millis()
import { PINS, DTR_BUSY_LEVEL, KEY_ROWS, KEY_COLS, KEY_COUNT, LINK_BAUD } from '../common/pins.js';
import { encodeFrame, FrameParser } from '../common/frame.js';
import { MSG, PS, NAK, build, parse } from '../common/messages.js';
import { ESC_INIT, rasterHeader, feedLines, heatConfig, concat } from '../common/escpos.js';

const FW_VERSION = 1;
const PQ_CAP = 4096; // очередь печати к принтеру
const PRN_CHUNK = 32; // байт за один проход, пока DTR не занят
const STATUS_PERIOD_MS = 20;

export class PeripheralController {
  constructor(hal) {
    this.hal = hal;
    this.seq = 0;
    this.debounceMs = 5;
    // очередь печати (кольцевой буфер)
    this.pq = new Uint8Array(PQ_CAP);
    this.pqHead = 0;
    this.pqLen = 0;
    // клавиши
    this.rawState = new Uint8Array(KEY_COUNT);
    this.stable = new Uint8Array(KEY_COUNT);
    this.counter = new Uint8Array(KEY_COUNT);
    // статус
    this.lastStatusAt = 0;
    this.lastFlags = -1;
    this.lastCredit = -1;
    this.tx = []; // очередь исходящих байт к Guition (UART может принять не всё сразу)
    this.parser = new FrameParser((f) => this.onFrame(f), () => { this.crcErrors = (this.crcErrors ?? 0) + 1; });
    this.crcErrors = 0;
  }

  setup() {
    const g = this.hal.gpio;
    PINS.ROWS.forEach((p) => g.pinMode(p, 'in'));
    PINS.COLS.forEach((p) => g.pinMode(p, 'in_pullup'));
    g.pinMode(PINS.PRN_DTR, 'in');
    this.hal.host.setBaud(LINK_BAUD);
    this.sendHello();
  }

  loop() {
    const now = this.hal.millis();
    this.scanKeys();
    this.pollHost();
    this.pumpPrinter();
    this.sendStatusIfNeeded(now);
    this.flushTx();
  }

  // ---------- клавиатура ----------
  scanKeys() {
    const g = this.hal.gpio;
    for (let r = 0; r < KEY_ROWS; r++) {
      g.pinMode(PINS.ROWS[r], 'out');
      g.digitalWrite(PINS.ROWS[r], 0);
      for (let c = 0; c < KEY_COLS; c++) {
        this.rawState[r * KEY_COLS + c] = g.digitalRead(PINS.COLS[c]) === 0 ? 1 : 0;
      }
      g.pinMode(PINS.ROWS[r], 'in'); // Hi-Z, чтобы не коротить соседние строки
    }
    for (let k = 0; k < KEY_COUNT; k++) {
      if (this.rawState[k] === this.stable[k]) { this.counter[k] = 0; continue; }
      if (++this.counter[k] >= this.debounceMs) {
        this.stable[k] = this.rawState[k];
        this.counter[k] = 0;
        this.send(MSG.KEY, build.key(k, this.stable[k] === 1));
      }
    }
  }

  // ---------- канал к Guition ----------
  pollHost() {
    const h = this.hal.host;
    while (h.available() > 0) this.parser.pushByte(h.read());
  }

  send(type, payload) {
    const frame = encodeFrame({ type, seq: this.seq++ & 0xff, payload });
    for (const b of frame) this.tx.push(b);
  }

  flushTx() {
    if (!this.tx.length) return;
    const n = this.hal.host.write(Uint8Array.from(this.tx.slice(0, this.hal.host.txFree())));
    this.tx.splice(0, n);
  }

  sendHello() { this.send(MSG.HELLO, build.hello(FW_VERSION, 0)); }

  credit() { return PQ_CAP - this.pqLen; }

  flags() {
    const busy = this.hal.gpio.digitalRead(PINS.PRN_DTR) === DTR_BUSY_LEVEL;
    return (busy ? PS.BUSY : 0) | (this.pqLen > 0 ? PS.PENDING : 0);
  }

  sendStatusIfNeeded(now) {
    if (now - this.lastStatusAt < STATUS_PERIOD_MS) return;
    const flags = this.flags();
    const credit = this.credit();
    if (flags === this.lastFlags && Math.abs(credit - this.lastCredit) < 256) return;
    this.lastStatusAt = now;
    this.lastFlags = flags;
    this.lastCredit = credit;
    this.send(MSG.PRINTER_STATUS, build.printerStatus(flags, credit));
  }

  onFrame(f) {
    switch (f.type) {
      case MSG.PING: this.sendHello(); break;
      case MSG.PRINT_RAW: this.accept(f, f.payload); break;
      case MSG.PRINT_BEGIN: {
        const b = parse.printBegin(f.payload);
        this.accept(f, rasterHeader(b.widthBytes, b.rows));
        break;
      }
      case MSG.PRINT_ROWS: this.accept(f, f.payload); break;
      case MSG.PRINT_END: this.accept(f, feedLines(parse.printEnd(f.payload).feedLines)); break;
      case MSG.PRINTER_CFG: {
        const c = parse.printerCfg(f.payload);
        this.hal.prn.setBaud(c.baud);
        // инициализация принтера — только ПОСЛЕ выставления скорости UART, иначе уйдёт мусор
        this.accept(f, concat(ESC_INIT, heatConfig(c.n1, c.n2, c.n3)));
        break;
      }
      case MSG.KEY_CFG: this.debounceMs = Math.max(1, parse.keyCfg(f.payload).debounceMs); this.ack(f.seq); break;
      default: this.send(MSG.NAK, build.nak(f.seq, NAK.UNKNOWN));
    }
  }

  /** Принять данные в очередь печати или ответить NAK при нехватке места. */
  accept(f, bytes) {
    if (bytes.length > this.credit()) { this.send(MSG.NAK, build.nak(f.seq, NAK.OVERFLOW)); return; }
    this.pushPrint(bytes);
    this.ack(f.seq);
  }

  ack(seq) { this.send(MSG.ACK, build.ack(seq, this.credit())); }

  // ---------- принтер ----------
  pushPrint(bytes) {
    for (const b of bytes) this.pq[(this.pqHead + this.pqLen++) % PQ_CAP] = b;
  }

  pumpPrinter() {
    const g = this.hal.gpio;
    const p = this.hal.prn;
    // не пишем, пока принтер сигналит «занят»
    while (this.pqLen > 0 && p.txFree() > 0 && g.digitalRead(PINS.PRN_DTR) !== DTR_BUSY_LEVEL) {
      const n = Math.min(PRN_CHUNK, this.pqLen, p.txFree());
      const chunk = new Uint8Array(n);
      for (let i = 0; i < n; i++) chunk[i] = this.pq[(this.pqHead + i) % PQ_CAP];
      const w = p.write(chunk);
      this.pqHead = (this.pqHead + w) % PQ_CAP;
      this.pqLen -= w;
      if (w < n) break;
      break; // один чанк за проход loop(), как в реальном цикле на ~1 кГц
    }
  }
}
