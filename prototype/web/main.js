// Веб-панель стенда: собирает мир из браузерных HAL, рисует клавиатуру, дисплей и ленту.
// Технические параметры и лог — в выдвижной панели.
import { createWorld } from '../src/world.js';
import { KEYS, codeOf } from '../src/guition/keymap.js';
import { describe, MSG } from '../src/common/messages.js';
import { PRINTER_BAUD_DEFAULT } from '../src/common/pins.js';
import { createSurface, PanelDisplay, VirtualSd, seedSd, makePrinterFont, localStorageHal, createAssets, createBeeper } from './browser-hal.js';
import { TapeView } from './tape.js';

const $ = (id) => document.getElementById(id);
const sd = new VirtualSd();
seedSd(sd);
const display = new PanelDisplay($('screen'));
const renderLine = makePrinterFont();
const assets = createAssets();
const beep = createBeeper();

const opts = { volts: 9, printerBaud: PRINTER_BAUD_DEFAULT, appPrinterBaud: PRINTER_BAUD_DEFAULT };
let world = null;
const logLines = [];
const latched = new Set();
const held = new Set();
const pressedAt = new Map();
const releases = [];
const MIN_HOLD_MS = 30; // клавиша держится минимум столько виртуального времени (дебаунс 5 мс)
let speed = 1;

const tape = new TapeView($('tape'), $('tape-scroll'), { rows: [], version: 0 });

function build() {
  const prevPaper = world?.printer.paper;
  world = createWorld({
    createSurface, present: (s) => display.present(s), setBrightness: (p) => display.setBrightness(p),
    sd, renderLine, storage: localStorageHal, assets, beep, epoch: () => Date.now(), ...opts,
  });
  if (prevPaper) world.printer.paper = prevPaper; // лента переживает перезагрузку
  tape.setPaper(world.printer.paper);
  world.onLinkFrame((dir, f, t) => { logLines.push({ t, dir, f }); if (logLines.length > 400) logLines.shift(); });
  window.kossa = { world, sd, KEYS };
}
build();

// ---------- клавиатура ----------
function pressKey(code) { world.pressKey(code); held.add(code); pressedAt.set(code, world.clock.ms); paintKeys(); }
function releaseKey(code) {
  if (!held.delete(code)) return;
  if (!latched.has(code)) {
    const wait = (pressedAt.get(code) ?? 0) + MIN_HOLD_MS - world.clock.ms;
    if (wait > 0) releases.push({ code, at: world.clock.ms + wait }); else world.releaseKey(code);
  }
  paintKeys();
}

const keypadEl = $('keypad');
const keyEls = [];
KEYS.forEach((k, code) => {
  if (code === 16) { const gap = document.createElement('div'); gap.className = 'gap'; keypadEl.appendChild(gap); }
  const b = document.createElement('button');
  const digit = /^d/.test(k.id) || k.id === 'dot';
  b.className = `key ${digit ? 'digit' : k.kind ?? ''}`;
  b.innerHTML = k.icon && !['minus', 'plus'].includes(k.id)
    ? `<i data-lucide="${k.icon}"></i>${['up', 'down', 'left', 'right', 'bs', 'mul'].includes(k.id) ? '' : `<span class="lbl">${k.label}</span>`}`
    : k.icon ? `<i data-lucide="${k.icon}"></i>` : k.label;
  b.title = k.label;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (latched.has(code)) { latched.delete(code); world.releaseKey(code); } else { latched.add(code); world.pressKey(code); }
      paintKeys();
    } else pressKey(code);
  });
  b.addEventListener('pointerup', () => releaseKey(code));
  b.addEventListener('pointerleave', () => releaseKey(code));
  keypadEl.appendChild(b);
  keyEls.push(b);
});
function paintKeys() {
  keyEls.forEach((b, code) => {
    b.classList.toggle('on', world.keypad.isPressed(code));
    b.classList.toggle('latched', latched.has(code));
  });
}

// горячие клавиши компьютера
const byKey = {
  '0': 'd0', '1': 'd1', '2': 'd2', '3': 'd3', '4': 'd4', '5': 'd5', '6': 'd6', '7': 'd7', '8': 'd8', '9': 'd9',
  '.': 'dot', ',': 'dot', Enter: 'ok', Backspace: 'bs', Escape: 'clr', Delete: 'annul',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', '+': 'plus', '-': 'minus', '*': 'mul',
  F1: 'm1', F2: 'm2', F3: 'm3', F4: 'm4',
};
const byCode = { KeyK: 'code', KeyP: 'pay', KeyD: 'disc', KeyR: 'ret', KeyM: 'menu', KeyX: 'mul' };
const keyFor = (e) => byKey[e.key] ?? byCode[e.code];
$('hotkeys').textContent = 'Клавиши: цифры, «.», Enter — ИТОГ, Backspace — ⌫, Esc — C, стрелки, +/−, * или X — ×, F1–F4 — М1–М4, K — Код, P — Оплата, D — Скидка, R — Возврат, M — Меню, Delete — Аннуляция. Shift+клик по клавише — залипание.';
addEventListener('keydown', (e) => {
  if (e.target?.matches?.('select, input') || e.metaKey || e.ctrlKey) return;
  const id = keyFor(e);
  if (!id) return;
  e.preventDefault();
  if (!e.repeat) pressKey(codeOf(id));
});
addEventListener('keyup', (e) => { const id = keyFor(e); if (id) releaseKey(codeOf(id)); });

// ---------- раскладка: экран и кнопки занимают максимум места ----------
function layout() {
  const dev = document.querySelector('.device');
  const maxW = dev.clientWidth - 12;
  const maxH = dev.clientHeight * (dev.clientHeight < 600 ? 0.42 : 0.5) - 12; // на низком окне больше места кнопкам
  const k = Math.min(maxW / 480, maxH / 272);
  const c = $('screen');
  c.style.width = Math.floor(480 * k) + 'px';
  c.style.height = Math.floor(272 * k) + 'px';
}
addEventListener('resize', layout);
new ResizeObserver(layout).observe(document.querySelector('.device'));
layout();

// ---------- лента и панель ----------
// Лента: на узком окне скрыта по умолчанию и открывается поверх устройства
let tapeWanted = null; // null — авто, true/false — выбор пользователя
const NARROW = 900;
function applyTape() {
  const narrow = innerWidth < NARROW;
  document.querySelector('.app').classList.toggle('narrow', narrow);
  const show = tapeWanted ?? !narrow;
  $('tape-col').classList.toggle('hidden', !show);
  $('floating').classList.toggle('show', !show);
  layout();
}
const setTape = (show) => { tapeWanted = show; applyTape(); };
$('tape-toggle').onclick = () => setTape(false);
$('tape-show').onclick = () => setTape(true);
addEventListener('resize', () => { if (tapeWanted === true && innerWidth < NARROW) tapeWanted = null; applyTape(); });
applyTape();
const openDrawer = () => $('drawer').classList.add('open');
$('drawer-open').onclick = openDrawer;
$('drawer-open2').onclick = openDrawer;
$('drawer-close').onclick = () => $('drawer').classList.remove('open');
$('tape-reset').onclick = () => world.printer.paper.clear();
$('tape-save').onclick = () => { const a = document.createElement('a'); a.href = tape.toPNGBlobURL(); a.download = 'lenta.png'; a.click(); };

$('speed').onchange = (e) => { speed = Number(e.target.value); };
$('volts').onchange = (e) => { opts.volts = Number(e.target.value); world.printer.setVolts(opts.volts); };
$('prn-baud').onchange = (e) => { opts.printerBaud = Number(e.target.value); world.printer.uart.setBaud(opts.printerBaud); };
$('app-baud').onchange = (e) => { opts.appPrinterBaud = Number(e.target.value); };
$('reboot').onclick = () => { latched.clear(); held.clear(); releases.length = 0; logLines.length = 0; build(); paintKeys(); };
$('wipe').onclick = () => { if (confirm('Стереть базу, настройки и журнал кассы?')) { localStorageHal.clear(); $('reboot').onclick(); } };
$('sd-file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const bmp = await createImageBitmap(f);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  sd.add(f.name, { width: c.width, height: c.height, rgba: g.getImageData(0, 0, c.width, c.height).data });
  e.target.value = '';
  world.app.toast('SD: ' + f.name);
};

function bar(frac, hot) { return `<div class="bar ${hot ? 'hot' : ''}"><i style="width:${Math.round(frac * 100)}%"></i></div>`; }
let fps = 0;
function renderStats() {
  const p = world.printer, a = world.app, rp = world.rp;
  const rows = [
    ['Скорость печати', `${p.speedMmS()} мм/с`],
    ['Буфер принтера', `${p.uart.rx.len} / ${p.uart.rx.cap}${bar(p.uart.rx.len / p.uart.rx.cap, p.busy)}`],
    ['DTR', p.busy ? '<span class="err">занят</span>' : '<span class="ok-t">готов</span>'],
    ['Напечатано', `${(p.stats.rows / 8 / 10).toFixed(1)} см`],
    ['Очередь RP2040', `${rp.pqLen} / 4096${bar(rp.pqLen / 4096, false)}`],
    ['Кредит Guition', String(a.effectiveCredit())],
    ['Потеряно байт', `<span class="${p.uart.rxOverflow ? 'err' : ''}">${p.uart.rxOverflow}</span>`],
    ['Ошибки скорости', `<span class="${p.uart.framingErrors ? 'err' : ''}">${p.uart.framingErrors}</span>`],
    ['Не-ASCII → «?»', String(p.stats.nonAscii)],
    ['CRC линка', String(rp.crcErrors + a.linkErrors)],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('about').innerHTML = [
    ['Дисплей', 'Guition JC4827W543 · 480×272 · RGB565'], ['Кадров/с', String(fps)],
    ['Принтер', 'QR701 · 384 точки · 203 dpi · 48 мм'], ['Лента', `${p.paper.rows.length} строк`],
    ['Клавиатура', '2× мембрана 4×4 → матрица 8×4'], ['Виртуальное время', `${(world.clock.ms / 1000).toFixed(1)} с`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

let lastLogLen = -1, lastHide = null;
function renderLog() {
  if (!$('drawer').classList.contains('open')) return;
  const hide = $('hide-noise').checked;
  if (logLines.length === lastLogLen && hide === lastHide) return;
  lastLogLen = logLines.length; lastHide = hide;
  const shown = logLines.filter(({ f }) => !hide || (f.type !== MSG.ACK && f.type !== MSG.PRINTER_STATUS)).slice(-80);
  const el = $('log');
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  el.textContent = shown.map(({ t, dir, f }) => `${String(t).padStart(7)} ${dir === 'rp2gu' ? 'RP→GU' : 'GU→RP'} ${describe(f)}`).join('\n');
  if (stick) el.scrollTop = el.scrollHeight;
}

// ---------- главный цикл ----------
let last = performance.now(), carry = 0, fpsT = performance.now(), fpsN = 0, statT = 0;
function pump(now = performance.now()) {
  const dt = Math.min(now - last, 100);
  last = now;
  carry += dt * speed;
  const steps = Math.floor(carry);
  carry -= steps;
  if (steps > 0) world.step(steps);
  for (let i = releases.length - 1; i >= 0; i--) {
    if (world.clock.ms >= releases[i].at) { world.releaseKey(releases[i].code); releases.splice(i, 1); }
  }
  display.refresh();
  tape.refresh();
  fpsN++;
  if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now; }
  if (now - statT > 150) { statT = now; renderStats(); renderLog(); paintKeys(); }
}
// rAF останавливается в скрытых вкладках — таймер продолжает вести симуляцию
function frame(now) { pump(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setInterval(() => pump(), 20);
window.lucide?.createIcons();
