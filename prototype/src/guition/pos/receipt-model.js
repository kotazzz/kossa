// Открытый чек: позиции, скидки/надбавки (всегда после позиций), оплаты. Чистая логика, без UI.
import { lineSum } from './format.js';

export class Receipt {
  constructor() {
    /** @type {{name:string, code:string|null, price:number, qtyMilli:number, weighted:boolean, taxId:number, section:number}[]} */
    this.items = [];
    /** @type {{kind:'discount'|'markup', mode:'pct'|'abs', value:number}[]} value: базисные пункты или копейки */
    this.adjustments = [];
    /** @type {{method:'cash'|'card', amount:number, tendered?:number, change?:number}[]} */
    this.payments = [];
  }

  isEmpty() { return this.items.length === 0 && this.adjustments.length === 0; }
  hasPayments() { return this.payments.length > 0; }

  addItem({ name, code = null, price, qtyMilli = 1000, weighted = false, taxId = 0, section = 1 }) {
    const last = this.items[this.items.length - 1];
    if (!weighted && last && !last.weighted && last.code === code && last.price === price && last.name === name && last.section === section && this.adjustments.length === 0) {
      last.qtyMilli += qtyMilli;
      return last;
    }
    const it = { name, code, price, qtyMilli, weighted, taxId, section };
    this.items.push(it);
    return it;
  }

  addAdjustment({ kind, mode, value }) {
    const a = { kind, mode, value };
    this.adjustments.push(a);
    return a;
  }

  /** Единый список для экрана и удаления: позиции, затем скидки/надбавки. */
  entries() {
    return [
      ...this.items.map((ref, i) => ({ type: 'item', ref, index: i })),
      ...this.adjustments.map((ref, i) => ({ type: 'adj', ref, index: i })),
    ];
  }

  removeEntry(i) {
    const e = this.entries()[i];
    if (!e) return null;
    if (e.type === 'item') this.items.splice(e.index, 1);
    else this.adjustments.splice(e.index, 1);
    return e;
  }

  paid() { return this.payments.reduce((a, p) => a + p.amount, 0); }

  /**
   * Итоги. Скидки/надбавки применяются последовательно к текущей сумме; налоги считаются с базы позиций,
   * пропорционально скорректированной; «сверху» добавляются к итогу, «включённые» только выделяются.
   * @param {{id:number,name:string,rate:number,mode:'incl'|'add'}[]} taxes rate в базисных пунктах
   */
  totals(taxes = []) {
    const lines = this.items.map((it) => lineSum(it.price, it.qtyMilli));
    const linesSum = lines.reduce((a, b) => a + b, 0);
    let running = linesSum;
    const adj = this.adjustments.map((a) => {
      const base = a.mode === 'pct' ? Math.round((running * a.value) / 10000) : a.value;
      let amount = a.kind === 'discount' ? -base : base;
      if (running + amount < 0) amount = -running;
      running += amount;
      return { ...a, amount };
    });
    const factor = linesSum > 0 ? running / linesSum : 0;
    let addTax = 0;
    const taxRows = taxes.map((t) => {
      const base = Math.round(this.items.reduce((s, it, i) => (it.taxId === t.id ? s + lines[i] : s), 0) * factor);
      const amount = t.mode === 'add' ? Math.round((base * t.rate) / 10000) : Math.round((base * t.rate) / (10000 + t.rate));
      if (t.mode === 'add') addTax += amount;
      return { id: t.id, name: t.name, rate: t.rate, mode: t.mode, base, amount };
    }).filter((t) => t.base > 0);
    const total = running + addTax;
    const paid = this.paid();
    // выручка по секциям: суммы строк с учётом скидок/надбавок (пропорционально), без начисляемых налогов
    const sections = {};
    this.items.forEach((it, i) => { const s = it.section ?? 1; sections[s] = (sections[s] ?? 0) + Math.round(lines[i] * factor); });
    const keys = Object.keys(sections);
    if (keys.length) sections[keys[0]] += running - keys.reduce((a, k) => a + sections[k], 0); // остаток округления
    return { lines, linesSum, adj, afterAdj: running, taxes: taxRows, addTax, total, paid, remaining: total - paid, sections };
  }

  snapshot() {
    return JSON.parse(JSON.stringify({ items: this.items, adjustments: this.adjustments, payments: this.payments }));
  }

  static from(snap) {
    const r = new Receipt();
    r.items = snap.items.map((x) => ({ ...x }));
    r.adjustments = (snap.adjustments ?? []).map((x) => ({ ...x }));
    return r;
  }
}
