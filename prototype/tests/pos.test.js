import test from 'node:test';
import assert from 'node:assert/strict';
import { Receipt } from '../src/guition/pos/receipt-model.js';
import { evaluatePayment } from '../src/guition/pos/payment.js';
import { Journal } from '../src/guition/pos/journal.js';
import { parseMoney, parseQty, money, fmtQty } from '../src/guition/pos/format.js';
import { searchProducts } from '../src/guition/db/search.js';
import { Store, memoryStorage, defaultDb } from '../src/guition/db/store.js';
import { T9Editor } from '../src/guition/ui/t9.js';
import { encodeQR } from '../src/common/qr.js';

const TAXES = [{ id: 1, name: 'НДС 20%', rate: 2000, mode: 'incl' }, { id: 2, name: 'Сбор', rate: 500, mode: 'add' }];

test('format: money / qty parsing', () => {
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('0.05'), 5);
  assert.ok(Number.isNaN(parseMoney('1.234')));
  assert.equal(parseQty('0.35'), 350);
  assert.equal(money(123456, { group: true }), '1 234.56');
  assert.equal(fmtQty(2000), '2');
  assert.equal(fmtQty(350, true), '0.350');
});

test('receipt: lines, merge, discounts and markups in order, taxes', () => {
  const r = new Receipt();
  r.addItem({ name: 'A', code: '1', price: 10000, taxId: 1 });
  r.addItem({ name: 'A', code: '1', price: 10000, taxId: 1 }); // слияние
  r.addItem({ name: 'Сыр', code: '51', price: 89000, qtyMilli: 350, weighted: true, taxId: 2 });
  assert.equal(r.items.length, 2);
  let t = r.totals(TAXES);
  assert.equal(t.linesSum, 20000 + 31150);
  r.addAdjustment({ kind: 'discount', mode: 'pct', value: 1000 }); // −10%
  r.addAdjustment({ kind: 'markup', mode: 'abs', value: 500 }); // +5 ₽
  t = r.totals(TAXES);
  assert.equal(t.adj[0].amount, -5115);
  assert.equal(t.adj[1].amount, 500);
  assert.equal(t.afterAdj, 51150 - 5115 + 500);
  const factor = t.afterAdj / 51150;
  const base2 = Math.round(31150 * factor);
  assert.equal(t.taxes.find((x) => x.id === 2).amount, Math.round(base2 * 0.05));
  assert.equal(t.total, t.afterAdj + t.addTax);
  // удаление: скидки — в конце списка
  const e = r.entries();
  assert.equal(e[2].type, 'adj');
  r.removeEntry(2);
  assert.equal(r.adjustments.length, 1);
});

test('payment rules', () => {
  const tot = { remaining: 10000 };
  assert.equal(evaluatePayment(tot, 'cash', null).kind, 'confirm_full');
  assert.equal(evaluatePayment(tot, 'card', 4000).kind, 'warn_partial');
  assert.equal(evaluatePayment(tot, 'card', 12000).code, 'card_over');
  assert.equal(evaluatePayment(tot, 'cash', 5000).code, 'cash_short');
  const ok = evaluatePayment(tot, 'cash', 15000);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.payment.change, 5000);
  assert.equal(ok.payment.amount, 10000);
});

test('split payment: card partial + card + cash with change', () => {
  const r = new Receipt();
  r.addItem({ name: 'X', price: 10000 });
  const p1 = evaluatePayment(r.totals(), 'card', 3000);
  r.payments.push(p1.payment);
  const p2 = evaluatePayment(r.totals(), 'card', 2000);
  r.payments.push(p2.payment);
  assert.equal(r.totals().remaining, 5000);
  const p3 = evaluatePayment(r.totals(), 'cash', 10000);
  assert.equal(p3.payment.change, 5000);
  r.payments.push(p3.payment);
  assert.equal(r.totals().remaining, 0);
});

test('journal: sale, return by number, cash in/out, X and Z', () => {
  const j = new Journal();
  const r = new Receipt();
  r.addItem({ name: 'A', code: '1', price: 10000, taxId: 1 });
  r.payments.push({ method: 'cash', amount: 10000, tendered: 20000, change: 10000 });
  const d1 = j.recordSale({ snap: r.snapshot(), totals: r.totals(TAXES), cashier: 'К', now: Date.UTC(2026, 9, 26, 10) });
  assert.equal(d1.no, 1);
  assert.equal(j.cashInDrawer(), 10000);
  assert.ok(j.recordCash({ dir: 'out', amount: 50000, cashier: 'К', now: 1 }).error);
  j.recordCash({ dir: 'in', amount: 5000, cashier: 'К', now: 2 });
  const ret = j.recordReturn({ no: 1, cashier: 'К', now: 3 });
  assert.equal(ret.type, 'return');
  assert.equal(j.recordReturn({ no: 1, cashier: 'К', now: 4 }).error, 'already');
  assert.equal(j.recordReturn({ no: 99, cashier: 'К', now: 4 }).error, 'not_found');
  const x = j.report(5);
  assert.equal(x.revenue, 10000);
  assert.equal(x.returnsSum, 10000);
  assert.equal(x.inDrawer, 5000);
  assert.equal(x.taxes[1], Math.round(10000 * 2000 / 12000));
  const z = j.closeShift(6);
  assert.equal(z.net, 0);
  assert.equal(j.shift.no, 2);
  assert.equal(j.acc.checks, 0);
  assert.equal(j.nextNo, 5); // 1 продажа, 1 внесение, 1 возврат, 1 Z (сквозная нумерация)
  // состояние переживает сериализацию
  const j2 = new Journal(JSON.parse(JSON.stringify(j)));
  assert.equal(j2.findDoc(1).returned, 3);
});

test('search: exact match first, then prefix by length', () => {
  const res = searchProducts(defaultDb().products, '123');
  assert.deepEqual(res.map((p) => p.code).slice(0, 3), ['123', '1234', '123555']);
  assert.equal(searchProducts(defaultDb().products, '12')[0].code, '12');
  assert.equal(searchProducts(defaultDb().products, '4601234567890')[0].code, '123'); // по штрихкоду
});

test('store: validate, unique code, persist', () => {
  const st = memoryStorage();
  const s = new Store(st);
  assert.equal(s.load().created, true);
  assert.match(s.upsertProduct({ code: '1', name: 'Дубль', weighted: false, price: 1, taxId: 0, section: 1, barcode: '' }), /занят/);
  assert.equal(s.upsertProduct({ code: '900', name: 'Новый', weighted: false, price: 100, taxId: 0, section: 1, barcode: '' }), null);
  const s2 = new Store(st);
  assert.equal(s2.load().created, false);
  assert.ok(s2.findByCode('900'));
  s2.deleteProduct('900');
  assert.equal(s2.findByCode('900'), null);
});

test('t9: multitap, timeout commit, layouts, caps, cursor', () => {
  const e = new T9Editor('');
  let t = 0;
  e.key('d2', t); e.key('d2', t += 100); // «б»
  e.tick(t += 1200);
  assert.equal(e.text, 'б');
  e.key('d0', t); // Abc: заглавная один раз
  e.key('d3', t += 10); e.key('d2', t += 10); // «Д» и затем «а» (другая клавиша фиксирует)
  assert.equal(e.value(), 'бДа');
  e.key('dot', t); // ENG
  e.key('d4', t += 10); e.key('d4', t += 10); e.key('d4', t += 10); // i
  assert.equal(e.value(), 'бДаi');
  e.key('left', t); e.key('bs', t);
  assert.equal(e.text, 'бДi');
  e.key('d0', t); e.key('d0', t); // ABC постоянно
  e.key('d2', t += 10); e.key('d3', t += 10);
  assert.equal(e.value(), 'бДADi'); // ENG: 2=A, 3=D
});

test('qr: versions grow with data, too long throws', () => {
  assert.equal(encodeQR('a').size, 21);
  assert.equal(encodeQR('x'.repeat(200)).version, 10);
  assert.throws(() => encodeQR('x'.repeat(300)));
});
