import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, runUntil, booted, type, printIdle } from './helpers.js';
import { unpackRow } from '../src/common/raster.js';

function chess(rows) {
  const data = new Uint8Array(48 * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < 48; x++) data[y * 48 + x] = ((y >> 3) & 1) ? 0xaa : 0x55;
  return { widthBytes: 48, rows, data };
}

test('hello handshake and status', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady && w.app.credit > 0, 500);
  assert.ok(w.app.rpReady);
  assert.ok(w.app.credit > 3000);
});

test('keypad press -> debounce -> KEY frame', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady, 500);
  const downs = [];
  w.onLinkFrame((dir, f) => { if (dir === 'rp2gu' && f.type === 2 && f.payload[1] === 1) downs.push(f.payload[0]); });
  w.pressKey(21); w.step(30); w.releaseKey(21); w.step(30);
  w.pressKey(21); w.step(30);
  assert.deepEqual(downs, [21, 21]);
});

test('short glitch shorter than debounce is ignored', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady, 500);
  const downs = [];
  w.onLinkFrame((dir, f) => { if (dir === 'rp2gu' && f.type === 2) downs.push(f.payload[0]); });
  w.pressKey(0); w.step(2); w.releaseKey(0); w.step(50);
  assert.equal(downs.length, 0);
});

test('3 keys in L-shape produce ghost key (real matrix behaviour)', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady, 500);
  const seen = [];
  w.onLinkFrame((dir, f) => { if (dir === 'rp2gu' && f.type === 2 && f.payload[1] === 1) seen.push(f.payload[0]); });
  // (row0,col0)=0, (row0,col1)=1, (row1,col1)=5 -> призрак (row1,col0)=4
  [0, 1, 5].forEach((c) => w.pressKey(c));
  w.step(60);
  assert.ok(seen.includes(4), 'ghost key 4 expected, got ' + seen);
});

test('raster print with DTR flow control: no overflow, all rows printed', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady, 500);
  w.app.queueRaster(chess(600), 2);
  const ms = runUntil(w, () => w.printer.stats.rows >= 600 + 2 * 30, 60000);
  assert.equal(w.printer.uart.rxOverflow, 0);
  assert.equal(w.printer.uart.framingErrors, 0);
  assert.equal(w.rp.crcErrors, 0);
  // 600 строк при 60 мм/с (480 строк/с) ~ 1250 мс + подача
  assert.ok(ms > 1200 && ms < 3000, 'ms=' + ms);
  const row0 = unpackRow(w.printer.paper.rows[0], 384);
  assert.equal(row0[0], 0); assert.equal(row0[1], 1);
  assert.equal(w.printer.paper.rows[599][0], 0x55);
});

test('printer at 5 V is slower', () => {
  const fast = makeWorld({ volts: 9, printerBaud: 460800, appPrinterBaud: 460800 }), slow = makeWorld({ volts: 5, printerBaud: 460800, appPrinterBaud: 460800 });
  for (const w of [fast, slow]) { runUntil(w, () => w.app.rpReady, 500); w.app.queueRaster(chess(240), 0); }
  const a = runUntil(fast, () => fast.printer.paper.rows.length >= 240, 60000);
  const b = runUntil(slow, () => slow.printer.paper.rows.length >= 240, 60000);
  assert.ok(b > a * 1.7, `fast=${a} slow=${b}`);
});

test('baud mismatch produces framing errors, nothing printed', () => {
  const w = makeWorld({ printerBaud: 9600 }); // принтер на 9600, приложение просит 115200
  runUntil(w, () => w.app.rpReady, 500);
  w.app.queueRaster(chess(8), 0);
  w.step(500);
  assert.ok(w.printer.uart.framingErrors > 0);
  assert.ok(!w.printer.paper.rows.some((r) => r[0] === 0xaa || r[0] === 0x55), 'raster must not survive');
});

test('matching 9600 baud works but is slow', async () => {
  const w = makeWorld({ printerBaud: 9600, appPrinterBaud: 9600 });
  assert.ok(await booted(w));
  w.printer.paper.clear();
  w.app.queueRaster(chess(40), 0);
  const ms = runUntil(w, () => w.printer.paper.rows.length >= 40, 60000);
  assert.ok(ms > 1500, 'ms=' + ms); // 40*48 байт = 1920 Б при 960 Б/с ~ 2 с
});

test('text via PRINT_RAW prints ascii only: non-ASCII becomes ?', () => {
  const w = makeWorld();
  runUntil(w, () => w.app.rpReady, 500);
  const bytes = Uint8Array.from([...'Hi\n'].map((c) => c.charCodeAt(0)).concat([0xd0, 0x9f, 0x0a]));
  w.app.queueRaw(bytes);
  runUntil(w, () => w.printer.paper.rows.length >= 60, 3000);
  assert.ok(w.printer.stats.nonAscii >= 2);
  assert.ok(w.printer.paper.rows.some((r) => r.some((b) => b !== 0)));
});

test('receipt: sale by code, cash payment with change, printed and journaled', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'ok', 'ok'); // Касса из главного меню, кассир по умолчанию
  await type(w, '1', 'code'); // код 1 + К — точное совпадение, добавляется
  await type(w, '2', 'mul', '1', '2', 'code'); // 2 × товар 12
  assert.equal(w.app.pos.receipt.items.length, 2);
  await type(w, 'pay', '5', '0', '0', 'm1'); // 500 наличными
  assert.equal(w.app.top().constructor.name, 'ChangeScreen');
  await type(w, 'ok');
  assert.equal(w.app.journal.docs.length, 1);
  assert.equal(w.app.journal.docs[0].payments[0].change, 50000 - (18000 + 2 * 9500));
  printIdle(w);
  assert.ok(w.printer.paper.rows.length > 300);
  assert.equal(w.printer.uart.rxOverflow, 0);
});
