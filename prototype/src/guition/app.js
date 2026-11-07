// «Прошивка» Guition JC4827W543 (ESP32-S3): касса. Экран 480x272, клавиатура через RP2040, печать через RP2040.
// Знает ТОЛЬКО про HAL:
//   hal.link        UART1 к RP2040 {write, txFree, available, read, setBaud}
//   hal.display     {width, height, present(surface), setBrightness?(pct)}
//   hal.createSurface(w,h) -> {ctx, getRGBA(), drawImageRGBA(img,x,y,w,h)} — подмножество Canvas2D
//   hal.storage     {load(key), save(key, obj)} — flash/SD
//   hal.assets      {loadFonts():Promise, loadIcons(names, onProgress):Promise, icons:{draw(ctx,name,x,y,size,color)}}
//   hal.millis(), hal.epoch() (RTC), hal.beep?(freq, ms)
import { encodeFrame, FrameParser } from '../common/frame.js';
import { MSG, PS, build, parse } from '../common/messages.js';
import { feedLines } from '../common/escpos.js';
import { PRINTER_BAUD_DEFAULT, LINK_BAUD, PRINTER_DOTS } from '../common/pins.js';
import { rgbaToGray, ditherFloydSteinberg, packMono } from '../common/raster.js';
import { KEYS } from './keymap.js';
import { buildTestPage, makeGradientRGBA } from './receipt.js';
import { Gfx, W, H, FOOTER_H, C } from './ui/gfx.js';
import { Store, HEAT_LEVELS } from './db/store.js';
import { Journal } from './pos/journal.js';
import { PosController } from './pos/controller.js';
import { BootScreen, MainMenu } from './screens/menu.js';
import { SaleScreen, CashierSelect } from './screens/sale.js';
import { reportsMenu, moneyMenu, dbMenu, settingsMenu } from './screens/modes.js';

const ROW_CHUNK = 240; // байт растра в одном кадре (5 строк по 48)
const FRAME_MS = 33;
const PING_RETRY_MS = 1000;

export const ICONS = [
  'shopping-cart', 'chart-column', 'hand-coins', 'database', 'settings', 'store', 'receipt', 'printer', 'cable', 'wifi-off',
  'search', 'package', 'percent', 'wallet', 'banknote', 'credit-card', 'undo-2', 'plus', 'minus', 'ban', 'info',
  'triangle-alert', 'circle-check', 'calculator', 'keyboard', 'clock', 'list', 'file-chart-column', 'user', 'scroll-text',
  'sliders-horizontal', 'arrow-down', 'layout-grid', 'users',
];

export class CashApp {
  constructor(hal) {
    this.hal = hal;
    this.seq = 0;
    this.out = [];
    this.parser = new FrameParser((f) => this.onFrame(f), () => { this.linkErrors++; });
    this.linkErrors = 0;
    this.rpReady = false;
    this.printerReady = false;
    this.cfgSeq = -1;
    this.credit = 0;
    this.inflight = new Map();
    this.printerFlags = 0;
    this.job = null;
    this.jobQueue = [];
    this.screens = [];
    this.waiters = [];
    this.toastMsg = null;
    this.lastDraw = -1000;
    this.surface = hal.createSurface(hal.display.width, hal.display.height);
    this.gfx = new Gfx(this.surface.ctx, hal.assets?.icons);
    this.db = new Store(hal.storage);
    this.journal = null;
    this.pos = null;
    this.boot = { progress: 0, current: '', done: false, errors: [] };
    this.lastPingAt = 0;
  }

  epoch() { return this.hal.epoch ? this.hal.epoch() : Date.now(); }

  // ---------- запуск: реальные задачи, прогресс = выполненная доля ----------
  setup() {
    this.hal.link.setBaud(LINK_BAUD);
    this.screens = [new BootScreen(this)];
    return this.runBoot();
  }

  async runBoot() {
    const b = this.boot;
    const tasks = [
      { name: 'Шрифты', w: 1, run: () => this.hal.assets?.loadFonts?.() },
      { name: 'Иконки', w: 3, run: (p) => this.hal.assets?.loadIcons?.(ICONS, p) },
      { name: 'База данных', w: 1, run: () => { this.db.load(); this.journal = new Journal(this.hal.storage.load('journal')); this.pos = new PosController(this); } },
      { name: 'Связь с RP2040', w: 1, run: () => { this.sendFrame(MSG.PING, new Uint8Array(0)); this.lastPingAt = this.hal.millis(); return this.waitFor(() => this.rpReady); } },
      { name: 'Принтер', w: 1, run: () => { this.sendFrame(MSG.KEY_CFG, build.keyCfg(5)); this.applyPrinterSettings(); return this.waitFor(() => this.printerReady); } },
    ];
    const total = tasks.reduce((a, t) => a + t.w, 0);
    let done = 0;
    for (const t of tasks) {
      b.current = t.name;
      try {
        await t.run((frac) => { b.progress = (done + t.w * frac) / total; });
      } catch (e) {
        b.errors.push(`${t.name}: ${e?.message ?? e}`);
      }
      done += t.w;
      b.progress = done / total;
    }
    b.current = '';
    b.done = true;
    this.applyBrightness();
    this.screens = [new MainMenu(this)];
  }

  /** Промис, который выполняется в loop(), когда условие станет истинным (без таймеров). */
  waitFor(cond) {
    return new Promise((resolve) => { this.waiters.push({ cond, resolve }); });
  }

  loop() {
    const now = this.hal.millis();
    const l = this.hal.link;
    while (l.available() > 0) this.parser.pushByte(l.read());
    if (this.waiters.length) {
      this.waiters = this.waiters.filter((w) => { if (w.cond()) { w.resolve(); return false; } return true; });
      if (!this.rpReady && now - this.lastPingAt > PING_RETRY_MS) { this.sendFrame(MSG.PING, new Uint8Array(0)); this.lastPingAt = now; }
    }
    this.pumpJob();
    this.flushOut();
    this.top()?.tick?.(now);
    if (this.toastMsg && now > this.toastMsg.until) this.toastMsg = null;
    if (now - this.lastDraw >= FRAME_MS) {
      this.draw();
      this.hal.display.present(this.surface);
      this.lastDraw = now;
    }
  }

  // ---------- стек экранов ----------
  top() { return this.screens[this.screens.length - 1]; }
  push(s) { this.screens.push(s); }
  pop() { if (this.screens.length > 1) this.screens.pop(); }
  replace(s) { this.screens[this.screens.length - 1] = s; }
  home() { this.screens = [new MainMenu(this)]; }

  openMode(id) {
    // вход в кассу: выбор кассира, если их несколько и чек не начат
    const sale = () => (this.pos.receipt.isEmpty() && this.db.activeCashiers().length > 1 ? new CashierSelect(this) : new SaleScreen(this));
    const make = { sale, reports: () => reportsMenu(this), money: () => moneyMenu(this), db: () => dbMenu(this), settings: () => settingsMenu(this) }[id];
    if (make) this.push(make());
  }

  toast(text, kind = 'info', ms = 2500) { this.toastMsg = { text, kind, until: this.hal.millis() + ms }; }

  onKey(code) {
    const key = KEYS[code];
    if (!key || !this.boot.done) return;
    if (this.db.settings?.sound) this.hal.beep?.(2400, 15);
    const top = this.top();
    if (key.id === 'menu' && !top.modal) {
      this.home();
      if (!this.pos.receipt.isEmpty()) this.toast('Открытый чек сохранён — вернитесь в «Кассу»');
      return;
    }
    top.onKey(key.id, this.hal.millis());
  }

  draw() {
    const g = this.gfx;
    // модальные окна рисуются поверх ближайшего немодального экрана
    let base = this.screens.length - 1;
    while (base > 0 && this.screens[base].modal) base--;
    for (let i = base; i < this.screens.length; i++) this.screens[i].draw(g);
    if (this.toastMsg && this.boot.done) {
      const t = this.toastMsg;
      const color = { error: C.danger, ok: C.ok, info: C.info }[t.kind] ?? C.info;
      const w = Math.min(W - 20, g.measure(t.text, 13, 600) + 44);
      const x = (W - w) / 2, y = H - FOOTER_H - 34;
      g.rrect(x, y, w, 28, 8, C.panel2, color);
      g.icon(t.kind === 'error' ? 'triangle-alert' : t.kind === 'ok' ? 'circle-check' : 'info', x + 8, y + 6, 16, color);
      g.text(t.text, x + 30, y + 14, { size: 13, weight: 600, maxW: w - 40 });
    }
  }

  // ---------- состояние ----------
  saveJournal() { this.hal.storage.save('journal', this.journal.toJSON()); }

  resetAll() {
    this.db.reset();
    this.journal = new Journal();
    this.saveJournal();
    this.pos = new PosController(this);
    this.applyPrinterSettings();
    this.applyBrightness();
    this.home();
  }

  applyBrightness() { this.hal.display.setBrightness?.(this.db.settings?.brightness ?? 100); }

  applyPrinterSettings() {
    const h = HEAT_LEVELS[this.db.settings?.heat ?? 1];
    this.cfgSeq = this.sendFrame(MSG.PRINTER_CFG, build.printerCfg(this.hal.printerBaud ?? PRINTER_BAUD_DEFAULT, h.n1, h.n2, h.n3));
  }

  printerState() {
    if (!this.rpReady || !this.printerReady) return 'off';
    if (this.job || this.jobQueue.length || (this.printerFlags & (PS.BUSY | PS.PENDING))) return 'busy';
    return 'ready';
  }

  // ---------- канал ----------
  sendFrame(type, payload, cost = 0) {
    const seq = this.seq++ & 0xff;
    if (cost > 0) this.inflight.set(seq, cost);
    for (const b of encodeFrame({ type, seq, payload })) this.out.push(b);
    return seq;
  }

  flushOut() {
    if (!this.out.length) return;
    const n = this.hal.link.write(Uint8Array.from(this.out.slice(0, this.hal.link.txFree())));
    this.out.splice(0, n);
  }

  onFrame(f) {
    switch (f.type) {
      case MSG.HELLO: this.rpReady = true; break;
      case MSG.KEY: { const k = parse.key(f.payload); if (k.down) this.onKey(k.code); break; }
      case MSG.PRINTER_STATUS: { const s = parse.printerStatus(f.payload); this.printerFlags = s.flags; this.credit = s.credit; break; }
      case MSG.ACK: {
        const a = parse.ack(f.payload);
        this.inflight.delete(a.seq);
        this.credit = a.credit;
        if (a.seq === this.cfgSeq) this.printerReady = true;
        break;
      }
      case MSG.NAK: {
        const a = parse.nak(f.payload);
        this.inflight.delete(a.seq);
        if (this.job) { this.toast('Ошибка печати (NAK ' + a.code + ')', 'error'); this.job = null; }
        break;
      }
    }
  }

  effectiveCredit() {
    let used = 0;
    for (const c of this.inflight.values()) used += c;
    return this.credit - used;
  }

  // ---------- печать ----------
  queueRaster(r, feed = 4) { this.jobQueue.push({ kind: 'raster', r, feed, stage: 'begin', row: 0 }); }
  queueRaw(bytes) { this.jobQueue.push({ kind: 'raw', bytes }); }

  /** Печать документа PageBuilder с подачей из настроек. */
  printDoc(page, { dither = false } = {}) {
    this.queueRaster(page.render(this.hal.createSurface, { dither }), this.db.settings?.feedAfter ?? 4);
  }

  /** Картинка на всю ширину ленты, дизеринг Floyd–Steinberg. */
  printImage(img) {
    const h = Math.min(1200, Math.max(1, Math.round((img.height * PRINTER_DOTS) / img.width)));
    const s = this.hal.createSurface(PRINTER_DOTS, h);
    s.ctx.fillStyle = '#fff';
    s.ctx.fillRect(0, 0, PRINTER_DOTS, h);
    s.drawImageRGBA(img, 0, 0, PRINTER_DOTS, h);
    const gray = rgbaToGray(s.getRGBA(), PRINTER_DOTS, h);
    this.queueRaster(packMono(ditherFloydSteinberg(gray, PRINTER_DOTS, h), PRINTER_DOTS, h), this.db.settings?.feedAfter ?? 4);
  }

  printTest() { this.printDoc(buildTestPage(makeGradientRGBA()), { dither: true }); }
  feedPaper() { this.queueRaw(feedLines(3)); this.toast('Прогон ленты'); }

  pumpJob() {
    if (!this.job && this.jobQueue.length) this.job = this.jobQueue.shift();
    const j = this.job;
    if (!j || !this.rpReady || this.out.length > 0) return;
    const credit = this.effectiveCredit();
    if (j.kind === 'raw') {
      if (credit < j.bytes.length) return;
      this.sendFrame(MSG.PRINT_RAW, j.bytes, j.bytes.length);
      this.job = null;
      return;
    }
    if (j.stage === 'begin') {
      if (credit < 8) return;
      this.sendFrame(MSG.PRINT_BEGIN, build.printBegin(j.r.widthBytes, j.r.rows), 8);
      j.stage = 'rows';
    } else if (j.stage === 'rows') {
      const perFrame = Math.max(1, Math.floor(ROW_CHUNK / j.r.widthBytes));
      const n = Math.min(perFrame, j.r.rows - j.row, Math.floor(credit / j.r.widthBytes));
      if (n <= 0) return;
      const chunk = j.r.data.subarray(j.row * j.r.widthBytes, (j.row + n) * j.r.widthBytes);
      this.sendFrame(MSG.PRINT_ROWS, chunk, chunk.length);
      j.row += n;
      if (j.row >= j.r.rows) j.stage = 'end';
    } else if (j.stage === 'end') {
      if (credit < 3) return;
      this.sendFrame(MSG.PRINT_END, build.printEnd(j.feed), 3);
      this.job = null;
    }
  }

  jobProgress() {
    const j = this.job;
    return j && j.kind === 'raster' ? Math.round((j.row / j.r.rows) * 100) : null;
  }
}
