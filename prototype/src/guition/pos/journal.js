// Журнал документов (сквозная нумерация) и смена: счётчики для X/Z-отчётов по образцу Меркурия-180К.
// «В кассе» = наличные продажи + внесения − выплаты − возвраты наличными.

const MAX_DOCS = 1000;

export function emptyAcc() {
  return {
    salesCash: 0, salesCard: 0, discounts: 0, markups: 0,
    annulSum: 0, annulCount: 0, returnsSum: 0, returnsCash: 0, returnsCard: 0, returnsCount: 0,
    cashIn: 0, cashOut: 0, checks: 0, copies: 0,
    taxes: {}, items: {}, hourly: {},
  };
}

/** Счётчики кассира (как в Z-отчёте по кассирам Меркурия). */
export function emptyCashierAcc() {
  return { salesCash: 0, salesCard: 0, discounts: 0, markups: 0, annulSum: 0, returnsSum: 0, cashIn: 0, cashOut: 0, checks: 0 };
}

/** Счётчики секции. */
export function emptySectionAcc() { return { sales: 0, returns: 0, count: 0 }; }

const cashierRef = (c) => (typeof c === 'string' ? { id: 0, name: c } : c ?? { id: 0, name: '' });
const sum = (arr, m) => arr.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0);

export class Journal {
  constructor(state = null) {
    const s = state ?? {};
    this.nextNo = s.nextNo ?? 1;
    this.shift = s.shift ?? { no: 1, open: false, openedAt: null, acc: emptyAcc() };
    this.gross = s.gross ?? 0;
    this.docs = s.docs ?? [];
    this.byCashier = s.byCashier ?? {}; // id -> {acc, gross}
    this.bySection = s.bySection ?? {}; // n -> {acc, gross}
    this.zCashiers = s.zCashiers ?? 0; // номер гашения по кассирам
    this.zSections = s.zSections ?? 0; // номер гашения по секциям
  }

  toJSON() {
    return {
      nextNo: this.nextNo, shift: this.shift, gross: this.gross, docs: this.docs,
      byCashier: this.byCashier, bySection: this.bySection, zCashiers: this.zCashiers, zSections: this.zSections,
    };
  }

  _cash(c) { return (this.byCashier[c.id] ??= { acc: emptyCashierAcc(), gross: 0 }).acc; }
  _sect(n) { return (this.bySection[n] ??= { acc: emptySectionAcc(), gross: 0 }).acc; }

  get acc() { return this.shift.acc; }

  _open(now) {
    if (!this.shift.open) { this.shift.open = true; this.shift.openedAt = now; }
  }

  _push(doc) {
    doc.no = this.nextNo++;
    doc.shift = this.shift.no;
    this.docs.push(doc);
    if (this.docs.length > MAX_DOCS) this.docs.shift();
    return doc;
  }

  findDoc(no) { return this.docs.find((d) => d.no === no) ?? null; }
  lastSale() { for (let i = this.docs.length - 1; i >= 0; i--) if (this.docs[i].type === 'sale') return this.docs[i]; return null; }

  revenue() { return this.acc.salesCash + this.acc.salesCard; }
  cashInDrawer() { const a = this.acc; return a.salesCash + a.cashIn - a.cashOut - a.returnsCash; }

  /** Закрытый оплаченный чек. */
  recordSale({ snap, totals, cashier, now }) {
    this._open(now);
    const a = this.acc;
    const who = cashierRef(cashier);
    const ca = this._cash(who);
    const cash = sum(snap.payments, 'cash');
    const card = sum(snap.payments, 'card');
    a.salesCash += cash; ca.salesCash += cash;
    a.salesCard += card; ca.salesCard += card;
    a.checks++; ca.checks++;
    for (const x of totals.adj) {
      if (x.amount < 0) { a.discounts += -x.amount; ca.discounts += -x.amount; } else { a.markups += x.amount; ca.markups += x.amount; }
    }
    for (const [n, v] of Object.entries(totals.sections ?? {})) { const sa = this._sect(n); sa.sales += v; sa.count++; }
    for (const t of totals.taxes) a.taxes[t.id] = (a.taxes[t.id] ?? 0) + t.amount;
    snap.items.forEach((it, i) => {
      const key = it.code ?? '—' + it.name;
      const row = a.items[key] ?? (a.items[key] = { code: it.code, name: it.name, qtyMilli: 0, sum: 0, weighted: it.weighted });
      row.qtyMilli += it.qtyMilli;
      row.sum += totals.lines[i];
    });
    const h = new Date(now).getHours();
    const hr = a.hourly[h] ?? (a.hourly[h] = { count: 0, sum: 0 });
    hr.count++;
    hr.sum += totals.total;
    return this._push({
      type: 'sale', at: now, cashier: who.name, cashierId: who.id, ...snap,
      totals: { lines: totals.lines, adj: totals.adj, taxes: totals.taxes, total: totals.total, sections: totals.sections },
    });
  }

  /** Аннулирование открытого чека целиком. */
  recordAnnul({ snap, totals, cashier, now }) {
    this._open(now);
    const who = cashierRef(cashier);
    this.acc.annulCount++;
    this.acc.annulSum += totals.total;
    this._cash(who).annulSum += totals.total;
    return this._push({ type: 'annul', at: now, cashier: who.name, cashierId: who.id, ...snap, totals: { total: totals.total } });
  }

  /** Возврат (полная аннуляция) чека по сквозному номеру. */
  recordReturn({ no, cashier, now }) {
    const d = this.findDoc(no);
    if (!d) return { error: 'not_found' };
    if (d.type !== 'sale') return { error: 'wrong_type' };
    if (d.returned) return { error: 'already' };
    this._open(now);
    const who = cashierRef(cashier);
    const cash = sum(d.payments, 'cash');
    const card = sum(d.payments, 'card');
    const a = this.acc;
    a.returnsCount++;
    a.returnsSum += cash + card;
    a.returnsCash += cash;
    a.returnsCard += card;
    this._cash(who).returnsSum += cash + card; // возврат числится за кассиром, который его оформил
    for (const [n, v] of Object.entries(d.totals.sections ?? { 1: d.totals.total })) this._sect(n).returns += v;
    d.returned = this.nextNo;
    return this._push({ type: 'return', at: now, cashier: who.name, cashierId: who.id, ref: no, items: d.items, adjustments: d.adjustments, payments: d.payments, totals: d.totals });
  }

  /** Внесение / выплата. */
  recordCash({ dir, amount, cashier, now }) {
    if (dir === 'out' && amount > this.cashInDrawer()) return { error: 'not_enough' };
    this._open(now);
    const who = cashierRef(cashier);
    const ca = this._cash(who);
    if (dir === 'in') { this.acc.cashIn += amount; ca.cashIn += amount; } else { this.acc.cashOut += amount; ca.cashOut += amount; }
    return this._push({ type: dir === 'in' ? 'cash_in' : 'cash_out', at: now, cashier: who.name, cashierId: who.id, amount });
  }

  recordCopy() { this.acc.copies++; }

  /** Данные для X-отчёта (без гашения). */
  report(now) {
    const a = this.acc;
    return {
      shiftNo: this.shift.no, open: this.shift.open, openedAt: this.shift.openedAt, at: now,
      ...a, revenue: this.revenue(), net: this.revenue() - a.returnsSum, inDrawer: this.cashInDrawer(), gross: this.gross,
    };
  }

  /** Z-отчёт: данные + закрытие смены и обнуление счётчиков. */
  closeShift(now) {
    const r = this.report(now);
    r.grossAfter = this.gross + r.net;
    this._push({ type: 'z', at: now, shiftNo: this.shift.no, net: r.net });
    this.gross = r.grossAfter;
    this.shift = { no: this.shift.no + 1, open: false, openedAt: null, acc: emptyAcc() };
    return r;
  }

  // ---------- отчёты по кассирам и секциям (своё гашение, не зависит от смены) ----------

  /** @param {{id:number,name:string}[]} cashiers все 8 кассиров */
  cashierReport(now, cashiers) {
    const rows = cashiers.map((c) => {
      const e = this.byCashier[c.id] ?? { acc: emptyCashierAcc(), gross: 0 };
      const total = e.acc.salesCash + e.acc.salesCard;
      const any = Object.values(e.acc).some((v) => v !== 0);
      return { id: c.id, name: c.name, ...e.acc, total, net: total - e.acc.returnsSum, gross: e.gross, any };
    });
    return { at: now, zNo: this.zCashiers + 1, rows };
  }

  closeCashiers(now, cashiers) {
    const r = this.cashierReport(now, cashiers);
    for (const row of r.rows) {
      const e = this.byCashier[row.id];
      if (!e) continue;
      e.gross += row.net;
      row.grossAfter = e.gross;
      e.acc = emptyCashierAcc();
    }
    this.zCashiers++;
    this._push({ type: 'z_cashiers', at: now, zNo: this.zCashiers });
    return r;
  }

  /** @param {{n:number,state:string,name:string}[]} sections все 16 секций */
  sectionReport(now, sections) {
    const rows = sections.map((x) => {
      const e = this.bySection[x.n] ?? { acc: emptySectionAcc(), gross: 0 };
      return { n: x.n, name: x.name, state: x.state, ...e.acc, net: e.acc.sales - e.acc.returns, gross: e.gross, any: e.acc.count > 0 || e.acc.returns > 0 };
    });
    return { at: now, zNo: this.zSections + 1, rows };
  }

  closeSections(now, sections) {
    const r = this.sectionReport(now, sections);
    for (const row of r.rows) {
      const e = this.bySection[row.n];
      if (!e) continue;
      e.gross += row.net;
      row.grossAfter = e.gross;
      e.acc = emptySectionAcc();
    }
    this.zSections++;
    this._push({ type: 'z_sections', at: now, zNo: this.zSections });
    return r;
  }
}
