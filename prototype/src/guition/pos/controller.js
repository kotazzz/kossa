// Контроллер кассовых операций: связывает чек, журнал, базу, печать и сохранение.
// Экраны вызывают только его методы. Результаты: {ok} или {error:'текст'}.
import { Receipt } from './receipt-model.js';
import { evaluatePayment, PAYMENT_ERRORS } from './payment.js';
import { parseMoney, parseQty, money, fmtDocNo } from './format.js';
import { saleDoc, returnDoc, annulDoc, cashDoc } from '../print/layout.js';

export class PosController {
  /** @param {import('../app.js').CashApp} app */
  constructor(app) {
    this.app = app;
    this.receipt = new Receipt();
    this.qtyMilli = null; // множитель «N ×» для следующей позиции
  }

  get db() { return this.app.db; }
  get journal() { return this.app.journal; }
  totals() { return this.receipt.totals(this.db.taxes); }
  locked() { return this.receipt.hasPayments(); }

  takeQty() { const q = this.qtyMilli ?? 1000; this.qtyMilli = null; return q; }

  setQty(str) {
    const q = parseQty(str);
    if (!(q > 0)) return { error: 'Неверное количество' };
    this.qtyMilli = q;
    return { ok: true };
  }

  /** Свободная цена в секцию (по умолчанию — секция из настроек). */
  addFree(priceStr, sectionNo = this.db.settings.defaultSection ?? 1) {
    if (this.locked()) return { error: 'Чек частично оплачен' };
    const price = parseMoney(priceStr);
    if (!(price > 0)) return { error: 'Неверная цена' };
    const err = this.db.checkSection(sectionNo, price);
    if (err) return { error: err };
    const sec = this.db.section(sectionNo);
    const name = sec.name ? sec.name : `Секция ${sectionNo}`;
    this.receipt.addItem({ name, price, qtyMilli: this.takeQty(), taxId: sec.taxId, section: sectionNo });
    return { ok: true };
  }

  /** @param {object} p товар из базы, qtyMilli — явное количество или null */
  addProduct(p, qtyMilli = null) {
    if (this.locked()) return { error: 'Чек частично оплачен' };
    const section = p.section ?? 1;
    const err = this.db.checkSection(section, p.price);
    if (err) return { error: err };
    const q = qtyMilli ?? this.takeQty();
    if (!p.weighted && q % 1000 !== 0) return { error: 'Штучный товар: целое количество' };
    // налог из базы товаров важнее налога секции (как у Меркурия)
    const taxId = p.taxId || this.db.section(section).taxId;
    this.receipt.addItem({ name: p.name, code: p.code, price: p.price, qtyMilli: q, weighted: p.weighted, taxId, section });
    this.qtyMilli = null;
    return { ok: true };
  }

  addAdjustment(kind, mode, str) {
    if (this.locked()) return { error: 'Чек частично оплачен' };
    if (!this.receipt.items.length) return { error: 'Чек пуст' };
    let value;
    if (mode === 'pct') {
      const v = parseMoney(str); // 12.5 -> 1250 = базисные пункты
      if (!(v > 0 && v <= 10000)) return { error: 'Процент: 0.01–100' };
      value = v;
    } else {
      value = parseMoney(str);
      if (!(value > 0)) return { error: 'Неверная сумма' };
      if (kind === 'discount' && value > this.totals().afterAdj) return { error: 'Скидка больше суммы чека' };
    }
    this.receipt.addAdjustment({ kind, mode, value });
    return { ok: true };
  }

  removeEntry(i) {
    if (this.locked()) return { error: 'Чек частично оплачен' };
    const e = this.receipt.removeEntry(i);
    return e ? { ok: true } : { error: 'Нет позиции' };
  }

  /** Оценка оплаты без применения (для диалогов). */
  evaluate(method, str) {
    const amount = str ? parseMoney(str) : null;
    if (str && Number.isNaN(amount)) return { kind: 'error', code: 'bad_amount' };
    return evaluatePayment(this.totals(), method, amount);
  }

  errorText(code) { return PAYMENT_ERRORS[code] ?? code; }

  addPayment(payment) {
    this.receipt.payments.push(payment);
    return this.totals().remaining;
  }

  /** Чек полностью оплачен: журнал, печать, новый чек. */
  finish() {
    const totals = this.totals();
    const doc = this.journal.recordSale({ snap: this.receipt.snapshot(), totals, cashier: this.db.currentCashier(), now: this.app.epoch() });
    this.app.saveJournal();
    this.app.printDoc(saleDoc(doc, this.db.data));
    this.receipt = new Receipt();
    this.qtyMilli = null;
    return doc;
  }

  annul() {
    if (this.receipt.isEmpty()) return { error: 'Чек пуст' };
    const doc = this.journal.recordAnnul({ snap: this.receipt.snapshot(), totals: this.totals(), cashier: this.db.currentCashier(), now: this.app.epoch() });
    this.app.saveJournal();
    this.app.printDoc(annulDoc({ ...doc, totals: { ...this.totals(), ...doc.totals } }, this.db.data));
    this.receipt = new Receipt();
    this.qtyMilli = null;
    return { ok: true, doc };
  }

  findForReturn(str) {
    const no = Number(str);
    if (!(no > 0)) return { error: 'Введите номер чека' };
    const d = this.journal.findDoc(no);
    if (!d) return { error: `Чек № ${fmtDocNo(no)} не найден` };
    if (d.type !== 'sale') return { error: `№ ${fmtDocNo(no)} — не чек продажи` };
    if (d.returned) return { error: `Чек уже возвращён (док. № ${fmtDocNo(d.returned)})` };
    return { ok: true, doc: d };
  }

  returnSale(no) {
    const r = this.journal.recordReturn({ no, cashier: this.db.currentCashier(), now: this.app.epoch() });
    if (r.error) return { error: r.error };
    this.app.saveJournal();
    this.app.printDoc(returnDoc(r, this.db.data));
    return { ok: true, doc: r };
  }

  cashOp(dir, str) {
    const amount = parseMoney(str);
    if (!(amount > 0)) return { error: 'Неверная сумма' };
    const r = this.journal.recordCash({ dir, amount, cashier: this.db.currentCashier(), now: this.app.epoch() });
    if (r.error) return { error: `В кассе только ${money(this.journal.cashInDrawer())}` };
    this.app.saveJournal();
    this.app.printDoc(cashDoc(r, this.db.data));
    return { ok: true, doc: r };
  }

  copyLast() {
    const d = this.journal.lastSale();
    if (!d) return { error: 'Нет чеков в журнале' };
    this.journal.recordCopy();
    this.app.saveJournal();
    this.app.printDoc(saleDoc(d, this.db.data, { copy: true }));
    return { ok: true, doc: d };
  }

  repeatLast() {
    const d = this.journal.lastSale();
    if (!d) return { error: 'Нет чеков в журнале' };
    this.receipt = Receipt.from(d);
    return { ok: true, doc: d };
  }
}
