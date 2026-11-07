// Несколько кассиров, секции (отделы), отчёты по кассирам и секциям — по мотивам Меркурия-180К.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, booted, type } from './helpers.js';
import { Store, memoryStorage, migrate } from '../src/guition/db/store.js';
import { Journal } from '../src/guition/pos/journal.js';
import { Receipt } from '../src/guition/pos/receipt-model.js';

const top = (w) => w.app.top().constructor.name;

test('migration v1 -> v2: cashier becomes cashier 1, sections created, products get section 1', () => {
  const st = memoryStorage();
  st.save('db', { version: 1, products: [{ code: '5', name: 'X', weighted: false, price: 100, taxId: 0, barcode: '' }], taxes: [], shop: { name: 'S', header: [], footer: [] }, cashier: 'Старый', settings: { heat: 1 } });
  const s = new Store(st);
  assert.equal(s.load().created, false);
  assert.equal(s.cashiers.length, 8);
  assert.equal(s.cashier, 'Старый');
  assert.equal(s.sections.length, 16);
  assert.equal(s.findByCode('5').section, 1);
  assert.equal(migrate(null), null);
});

test('section checks: closed section and price limit', () => {
  const s = new Store(memoryStorage());
  s.load();
  assert.match(s.checkSection(5, 100), /закрыта/);
  assert.match(s.checkSection(13, 30000), /лимита/);
  assert.equal(s.checkSection(13, 15000), null);
});

test('receipt section sums include discount share and reconcile with total', () => {
  const r = new Receipt();
  r.addItem({ name: 'A', price: 10000, section: 1 });
  r.addItem({ name: 'B', price: 5001, section: 2 });
  r.addAdjustment({ kind: 'discount', mode: 'pct', value: 1000 });
  const t = r.totals();
  assert.equal(t.sections[1] + t.sections[2], t.afterAdj);
  assert.equal(t.sections[1], 9000);
});

test('journal: per-cashier and per-section counters, own Z (shift stays open)', () => {
  const j = new Journal();
  const c1 = { id: 1, name: 'Иванова' }, c2 = { id: 2, name: 'Петров' };
  const sale = (cashier, price, section, method) => {
    const r = new Receipt();
    r.addItem({ name: 'x', price, section });
    r.payments.push({ method, amount: price });
    return j.recordSale({ snap: r.snapshot(), totals: r.totals(), cashier, now: 1 });
  };
  const d1 = sale(c1, 10000, 1, 'cash');
  sale(c2, 5000, 2, 'card');
  j.recordReturn({ no: d1.no, cashier: c2, now: 2 }); // возвращает другой кассир
  const cashiers = [c1, c2, { id: 3, name: '' }];
  const cr = j.cashierReport(3, cashiers);
  assert.equal(cr.rows[0].salesCash, 10000);
  assert.equal(cr.rows[1].salesCard, 5000);
  assert.equal(cr.rows[1].returnsSum, 10000);
  assert.equal(cr.rows[2].any, false);
  const sections = [{ n: 1, name: '', state: 'sale' }, { n: 2, name: '', state: 'sale' }];
  const sr = j.sectionReport(3, sections);
  assert.equal(sr.rows[0].sales, 10000);
  assert.equal(sr.rows[0].returns, 10000);
  assert.equal(sr.rows[1].sales, 5000);
  // гашение по кассирам не закрывает смену и не трогает секции
  const z = j.closeCashiers(4, cashiers);
  assert.equal(z.zNo, 1);
  assert.equal(z.rows[0].grossAfter, 10000);
  assert.equal(j.cashierReport(5, cashiers).rows[0].total, 0);
  assert.equal(j.cashierReport(5, cashiers).rows[1].gross, 5000 - 10000);
  assert.equal(j.sectionReport(5, sections).rows[0].sales, 10000);
  assert.equal(j.shift.open, true);
  const zs = j.closeSections(6, sections);
  assert.equal(zs.rows[1].grossAfter, 5000);
  assert.equal(j.zSections, 1);
  const again = new Journal(JSON.parse(JSON.stringify(j)));
  assert.equal(again.bySection[2].gross, 5000);
});

test('keyboard: choose cashier on entering cash mode; sale is attributed to them', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'ok');
  assert.equal(top(w), 'CashierSelect');
  await type(w, 'd2'); // кассир 2 цифрой
  assert.equal(top(w), 'SaleScreen');
  assert.equal(w.app.db.currentCashier().id, 2);
  await type(w, '1', 'code', 'pay', 'm2', 'ok');
  const d = w.app.journal.lastSale();
  assert.equal(d.cashierId, 2);
  assert.equal(d.cashier, 'Петров С.');
});

test('keyboard: free price into section via M1/M2 and «Секция №»; closed section refused', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'ok', 'ok');
  await type(w, '5', '0', 'm2'); // 50 ₽ в секцию 2
  await type(w, '7', '0', 'm3'); // «Секция №»
  assert.equal(top(w), 'NumberPrompt');
  await type(w, '1', '3', 'ok'); // в 13 (услуги, лимит 200)
  await type(w, '3', '0', '0', 'm3', '1', '3', 'ok'); // 300 > лимита
  assert.match(w.app.top().error, /лимита/);
  await type(w, 'clr', 'clr', 'clr');
  await type(w, '9', 'm3', '5', 'ok'); // секция 5 закрыта
  assert.match(w.app.top().error, /закрыта/);
  await type(w, 'clr', 'clr', 'clr');
  const items = w.app.pos.receipt.items;
  assert.deepEqual(items.map((i) => i.section), [2, 13]);
  assert.equal(items[1].name, 'Доставка');
  await type(w, '1', '0', 'ok'); // ИТОГ — секция по умолчанию (1)
  assert.equal(w.app.pos.receipt.items[2].section, 1);
});

test('keyboard: product without own tax takes tax from its section', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  w.app.db.upsertProduct({ code: '77', name: 'Без налога', weighted: false, price: 10000, taxId: 0, section: 3, barcode: '' });
  await type(w, 'ok', 'ok', '7', '7', 'code');
  assert.equal(w.app.pos.receipt.items[0].taxId, 2); // налог секции 3
});

test('keyboard: reports menu has X/Z by cashiers and by sections; Z by sections keeps shift open', async () => {
  const w = makeWorld();
  assert.ok(await booted(w));
  await type(w, 'ok', 'ok', '1', 'code', 'pay', 'm1', 'ok', 'menu');
  await type(w, 'd2'); // Отчёты
  const labels = w.app.top().items.map((i) => i.label);
  for (const l of ['X-отчёт по кассирам', 'Z-отчёт по кассирам', 'X-отчёт по секциям', 'Z-отчёт по секциям']) assert.ok(labels.includes(l), l);
  const zi = labels.indexOf('Z-отчёт по секциям');
  for (let i = 0; i < zi; i++) await type(w, 'down');
  await type(w, 'ok', 'ok');
  assert.equal(w.app.journal.zSections, 1);
  assert.equal(w.app.journal.shift.open, true);
  assert.equal(w.app.journal.bySection[2].gross, 18000);
});
