// Сценарии кассы через клавиатуру (весь стенд: матрица -> RP2040 -> кадры -> Guition).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, booted, type, printIdle } from './helpers.js';

async function sale() {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'ok', 'ok'); // главное меню -> Касса -> выбор кассира (текущий)
  return w;
}
const top = (w) => w.app.top().constructor.name;

test('free price + qty, discount % via M1, markup via minus + M2', async () => {
  const w = await sale();
  await type(w, '3', 'mul', '1', '0', '0', 'ok'); // 3 × 100 ₽
  await type(w, 'disc', '1', '0', 'm1'); // скидка 10%
  await type(w, 'disc', 'minus', '5', 'm2'); // надбавка 5 ₽
  const t = w.app.pos.totals();
  assert.equal(t.linesSum, 30000);
  assert.equal(t.total, 30000 - 3000 + 500);
});

test('search: live filter, exact first, add with ×quantity', async () => {
  const w = await sale();
  await type(w, 'code', '1', '2', '3');
  assert.equal(top(w), 'SearchScreen');
  assert.deepEqual(w.app.top().results().slice(0, 2).map((p) => p.code), ['123', '1234']);
  await type(w, 'down', 'mul', '4', 'ok'); // второй (1234) × 4
  const it = w.app.pos.receipt.items[0];
  assert.equal(it.code, '1234');
  assert.equal(it.qtyMilli, 4000);
});

test('weighted product asks for weight', async () => {
  const w = await sale();
  await type(w, '5', '1', 'code'); // сыр, весовой
  assert.equal(top(w), 'NumberPrompt');
  await type(w, '0', '.', '3', '5', 'ok');
  assert.equal(w.app.pos.receipt.items[0].qtyMilli, 350);
});

test('payment: no amount asks confirmation; card partial warns; cash short refused; split works', async () => {
  const w = await sale();
  await type(w, '1', '0', '0', '0', 'ok'); // 1000 ₽
  await type(w, 'pay', 'm2');
  assert.equal(w.app.top().dlgTitle, 'Сумма не введена');
  await type(w, 'clr');
  await type(w, '3', '0', '0', 'm2'); // карта 300 — частично
  assert.equal(w.app.top().dlgTitle, 'Частичная оплата картой');
  await type(w, 'ok');
  assert.equal(w.app.pos.totals().remaining, 70000);
  await type(w, '1', '0', '0', 'm1'); // наличные 100 < 700 — нельзя
  assert.equal(w.app.top().kind, 'error');
  await type(w, 'ok', 'clr', '2', '0', '0', 'm2', 'ok'); // вторая карта 200
  assert.equal(w.app.pos.totals().remaining, 50000);
  await type(w, '1', '0', '0', '0', 'm1'); // наличные 1000 -> сдача 500
  assert.equal(top(w), 'ChangeScreen');
  await type(w, 'ok');
  const d = w.app.journal.lastSale();
  assert.deepEqual(d.payments.map((p) => p.method), ['card', 'card', 'cash']);
  assert.equal(d.payments[2].change, 50000);
});

test('remove entry via Возврат on open receipt; annul whole receipt', async () => {
  const w = await sale();
  await type(w, '1', 'code', '2', 'code', 'disc', '5', 'm2');
  assert.equal(w.app.pos.receipt.entries().length, 3);
  await type(w, 'ret', 'ok', 'ok'); // выделена последняя (скидка) -> удалить -> да
  assert.equal(w.app.pos.receipt.adjustments.length, 0);
  await type(w, 'clr', 'annul', 'ok');
  assert.ok(w.app.pos.receipt.isEmpty());
  assert.equal(w.app.journal.acc.annulCount, 1);
});

test('return by receipt number, empty-receipt M1 copy and M2 repeat, X and Z', async () => {
  const w = await sale();
  await type(w, '1', 'code', 'pay', 'm1', 'ok'); // продажа №1 наличными без суммы
  const no = w.app.journal.lastSale().no;
  await type(w, 'm2'); // повтор покупки
  assert.equal(w.app.pos.receipt.items[0].code, '1');
  await type(w, 'annul', 'ok');
  await type(w, 'm1'); // копия
  assert.equal(w.app.journal.acc.copies, 1);
  await type(w, 'ret', String(no), 'ok');
  assert.equal(top(w), 'ReturnPreview');
  await type(w, 'ok', 'ok');
  assert.equal(w.app.journal.findDoc(no).returned > 0, true);
  assert.equal(w.app.journal.cashInDrawer(), 0);
  // X и Z через меню
  await type(w, 'menu', 'right', 'ok'); // Отчёты
  await type(w, 'ok'); // X-отчёт
  await type(w, 'down', 'ok', 'ok'); // Z + подтверждение
  assert.equal(w.app.journal.shift.no, 2);
  printIdle(w);
  assert.equal(w.printer.uart.rxOverflow, 0);
});

test('db: add product through form with T9 name, delete with confirm, persists', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'd4'); // режим 4 — База
  await type(w, 'ok', 'plus'); // Товары -> +
  assert.equal(top(w), 'FormScreen');
  await type(w, 'ok'); // название -> T9
  await type(w, 'd0', 'd5', 'd5', 'd5'); // Abc + 5×3 = «О»
  w.step(1200); // пауза фиксирует символ
  await type(w, 'd4', 'd4', 'ok'); // 4×2 = «й», ИТОГ
  assert.equal(w.app.top().obj.name, 'Ой');
  await type(w, 'down', 'down', 'ok', '9', '9', 'ok'); // цена 99
  await type(w, 'm1'); // сохранить
  const p = w.app.db.products.find((x) => x.price === 9900);
  assert.ok(p, 'saved');
  // удалить
  const count = w.app.db.products.length;
  for (let i = 0; i < count; i++) if (w.app.top().items()[w.app.top().list.sel]?.code !== p.code) await type(w, 'down');
  await type(w, 'minus', 'ok');
  assert.equal(w.app.db.products.length, count - 1);
});
