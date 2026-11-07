// Кассовый режим: чек, поиск по коду, количество, скидки/надбавки, оплата, сдача, возврат.
import { W, H, BODY_Y, BODY_H, C } from '../ui/gfx.js';
import { ListView, drawField } from '../ui/widgets.js';
import { Screen, Dialog, NumberPrompt } from '../ui/screen.js';
import { money, fmtQty, fmtPct, lineSum, fmtDocNo, fmtDateTime } from '../pos/format.js';
import { searchProducts } from '../db/search.js';

const isDigitKey = (id) => /^d\d$/.test(id) || id === 'd00' || id === 'dot';
const keyChar = (id) => (id === 'd00' ? '00' : id === 'dot' ? '.' : id.slice(1));

/** Ввод цифр в строку с ограничением длины и одной точкой. */
function editEntry(entry, id, max = 9) {
  if (id === 'bs') return entry.slice(0, -1);
  const ch = keyChar(id);
  if (ch === '.') return entry.includes('.') ? entry : (entry || '0') + '.';
  return (entry + ch).slice(0, max);
}

export class SaleScreen extends Screen {
  constructor(app) {
    super(app);
    this.entry = '';
    this.list = new ListView();
    this.removeMode = false;
  }
  get pos() { return this.app.pos; }
  get title() { return `Касса · чек № ${fmtDocNo(this.app.journal.nextNo)}`; }
  get icon() { return 'shopping-cart'; }

  softkeys() {
    if (this.removeMode) return ['Удалить', null, null, 'Выход'];
    if (this.entry && !this.pos.locked()) {
      // быстрые клавиши секций (как «1.» и «2.» у Меркурия) + выбор секции по номеру
      const db = this.app.db;
      const lbl = (n) => `СК${n}${db.section(n)?.name ? ' ' + db.section(n).name : ''}`;
      return [lbl(1), lbl(2), 'Секция №', null];
    }
    if (this.pos.receipt.isEmpty()) return ['Копия чека', 'Повтор', 'Прогон', 'Баланс'];
    if (this.pos.locked()) return ['Оплата', null, null, null];
    return ['Крупно', null, null, null];
  }

  err(text) { this.app.toast(text, 'error'); }

  onKey(id) {
    const pos = this.pos;
    const r = pos.receipt;
    if (this.removeMode) return this.onRemoveKey(id);
    if (isDigitKey(id) || (id === 'bs' && this.entry)) { this.entry = editEntry(this.entry, id); return true; }
    switch (id) {
      case 'clr':
        if (this.entry) this.entry = '';
        else if (pos.qtyMilli !== null) pos.qtyMilli = null;
        return true;
      case 'mul': {
        if (!this.entry) { this.err('Введите количество, затем ×'); return true; }
        const res = pos.setQty(this.entry);
        if (res.error) this.err(res.error); else this.entry = '';
        return true;
      }
      case 'ok': {
        if (!this.entry) { this.err('Введите цену и ИТОГ, или К — поиск'); return true; }
        const res = pos.addFree(this.entry);
        if (res.error) this.err(res.error); else { this.entry = ''; this.list.sel = 1e9; }
        return true;
      }
      case 'code': {
        const q = this.entry;
        this.entry = '';
        const exact = q ? this.app.db.findByCode(q) ?? this.app.db.products.find((p) => p.barcode === q) : null;
        if (exact && !exact.weighted) {
          const res = pos.addProduct(exact);
          if (res.error) this.err(res.error); else this.app.toast(`+ ${exact.name}`);
        } else if (exact) this.app.push(qtyPrompt(this.app, exact));
        else this.app.push(new SearchScreen(this.app, q));
        return true;
      }
      case 'up': this.scrolled = true; this.list.move(-1, r.entries().length); return true;
      case 'down': this.list.move(1, r.entries().length); if (this.list.sel >= r.entries().length - 1) this.scrolled = false; return true;
      case 'ret':
        if (r.isEmpty()) this.app.push(returnNumberPrompt(this.app));
        else if (pos.locked()) this.err('Чек частично оплачен — только аннуляция');
        else { this.removeMode = true; this.list.sel = r.entries().length - 1; }
        return true;
      case 'annul':
        if (r.isEmpty()) { this.err('Чек пуст'); return true; }
        this.app.push(new Dialog(this.app, {
          kind: 'confirm', title: 'Аннулировать чек?', text: `Сумма ${money(pos.totals().total)} ₽. Чек будет отменён целиком.`,
          onYes: () => { pos.annul(); this.entry = ''; this.app.toast('Чек аннулирован'); },
        }));
        return true;
      case 'disc':
        if (!r.items.length) { this.err('Сначала добавьте товары'); return true; }
        if (pos.locked()) { this.err('Чек частично оплачен'); return true; }
        this.app.push(discountPrompt(this.app, this.entry));
        this.entry = '';
        return true;
      case 'pay':
        if (!r.items.length) { this.err('Чек пуст'); return true; }
        this.app.push(new PaymentScreen(this.app, this.entry));
        this.entry = '';
        return true;
      case 'plus': case 'minus':
        if (!r.isEmpty()) { this.err('Внесение/выплата — при пустом чеке'); return true; }
        this.app.push(cashPrompt(this.app, id === 'plus' ? 'in' : 'out', this.entry));
        this.entry = '';
        return true;
      case 'm1': case 'm2': case 'm3':
        if (this.entry && !pos.locked()) { this.addToSection(id); return true; }
        if (id === 'm2') { if (r.isEmpty()) { const res = pos.repeatLast(); if (res.error) this.err(res.error); else this.app.toast(`Повтор чека № ${fmtDocNo(res.doc.no)}`); } return true; }
        if (id === 'm3') { if (r.isEmpty()) this.app.feedPaper(); return true; }
        if (r.isEmpty()) { const res = pos.copyLast(); if (res.error) this.err(res.error); else this.app.toast(`Копия чека № ${fmtDocNo(res.doc.no)}`); }
        else if (pos.locked()) this.app.push(new PaymentScreen(this.app, ''));
        else this.app.push(new BigTotalScreen(this.app));
        return true;
      case 'm4': if (r.isEmpty()) this.app.push(new BalanceScreen(this.app)); return true;
    }
    return false;
  }

  /** Цена из строки ввода -> секция 1/2 или выбор номера секции. */
  addToSection(id) {
    const price = this.entry;
    const add = (n) => {
      const res = this.pos.addFree(price, n);
      if (res.error) return res.error;
      this.entry = '';
      return null;
    };
    if (id === 'm1' || id === 'm2') { const e = add(id === 'm1' ? 1 : 2); if (e) this.err(e); return; }
    this.app.push(new NumberPrompt(this.app, {
      title: 'Секция', icon: 'layout-grid', label: 'Номер секции (1–16)', kind: 'int', maxLen: 2,
      extra: (g, x, y, w) => {
        g.text(`Цена ${price} ₽`, x, y + 8, { size: 13, color: C.muted });
        const open = this.app.db.openSections().map((sc) => `${sc.n}${sc.name ? ' ' + sc.name : ''}`).join(' · ');
        g.text(open, x, y + 32, { size: 11, color: C.dim, maxW: w });
      },
      onOk: (v) => { const e = add(Number(v)); if (e) return e; this.app.pop(); return null; },
    }));
  }

  onRemoveKey(id) {
    const entries = this.pos.receipt.entries();
    if (id === 'up') this.list.move(-1, entries.length);
    else if (id === 'down') this.list.move(1, entries.length);
    else if (id === 'clr' || id === 'ret' || id === 'm4') this.removeMode = false;
    else if (id === 'ok' || id === 'm1') {
      const e = entries[this.list.sel];
      if (!e) return true;
      const name = e.type === 'item' ? e.ref.name : (e.ref.kind === 'discount' ? 'Скидка' : 'Надбавка');
      this.app.push(new Dialog(this.app, {
        kind: 'confirm', title: 'Удалить из чека?', text: name,
        onYes: () => {
          this.pos.removeEntry(this.list.sel);
          if (this.pos.receipt.isEmpty()) this.removeMode = false;
          this.app.toast('Удалено');
        },
      }));
    }
    return true;
  }

  drawBody(g) {
    const pos = this.pos;
    const r = pos.receipt;
    const t = pos.totals();
    const entries = r.entries();
    const lx = 6, lw = 300, ly = BODY_Y + 4, lh = BODY_H - 8;
    g.rrect(lx, ly, lw, lh, 6, C.panel);
    if (!entries.length) {
      g.icon('shopping-cart', lx + lw / 2 - 20, ly + 40, 40, C.dim);
      g.text('Чек пуст', lx + lw / 2, ly + 104, { size: 15, weight: 700, color: C.muted, align: 'center' });
      g.text('Цена + ИТОГ · код + К · N × — количество', lx + lw / 2, ly + 128, { size: 11, color: C.dim, align: 'center' });
      g.text('+ / − — внесение / выплата', lx + lw / 2, ly + 146, { size: 11, color: C.dim, align: 'center' });
    } else {
      const adjByIndex = t.adj;
      if (!this.removeMode && !this.scrolled) this.list.sel = entries.length - 1; // показываем последние позиции
      this.list.draw(g, entries, lx + 4, ly + 4, lw - 12, lh - 8, 34, (g2, e, i, x, y, w, h, sel) => {
        const color = sel && this.removeMode ? C.danger : C.text;
        if (e.type === 'item') {
          const it = e.ref;
          g2.text(it.name, x + 6, y + 11, { size: 13, weight: 600, color, maxW: w - 90 });
          const q = it.weighted ? `${fmtQty(it.qtyMilli, true)} кг` : `${fmtQty(it.qtyMilli)} шт`;
          g2.text(`${q} × ${money(it.price)} · СК${it.section ?? 1}`, x + 6, y + 25, { size: 11, color: C.muted });
          g2.text(money(lineSum(it.price, it.qtyMilli), { group: true }), x + w - 6, y + 17, { size: 14, weight: 700, color, align: 'right' });
        } else {
          const a = adjByIndex[e.index];
          const name = a.kind === 'discount' ? 'Скидка' : 'Надбавка';
          g2.icon('percent', x + 6, y + 9, 16, a.kind === 'discount' ? C.ok : C.accent);
          g2.text(`${name}${a.mode === 'pct' ? ' ' + fmtPct(a.value) : ''}`, x + 28, y + 17, { size: 13, weight: 600, color });
          g2.text(money(a.amount, { group: true }), x + w - 6, y + 17, { size: 14, weight: 700, color: a.amount < 0 ? C.ok : C.accent, align: 'right' });
        }
      }, { showSel: this.removeMode || this.scrolled });
    }
    // правая панель: итог и ввод
    const rx = 314, rw = W - rx - 6;
    g.rrect(rx, ly, rw, 92, 6, C.panel);
    g.text('ИТОГ', rx + 10, ly + 14, { size: 11, weight: 700, color: C.muted });
    if (t.paid > 0) g.text(`осталось ${money(t.remaining)}`, rx + rw - 10, ly + 14, { size: 11, color: C.accent, align: 'right' });
    g.text(money(t.total, { group: true }), rx + rw - 10, ly + 52, { size: 32, weight: 800, color: C.accent, align: 'right', maxW: rw - 16 });
    g.text(`${r.items.length} поз.${t.adj.length ? ` · ${t.adj.length} скид./надб.` : ''}`, rx + 10, ly + 80, { size: 11, color: C.dim });
    drawField(g, rx, ly + 100, rw, this.removeMode ? 'УДАЛЕНИЕ: ↑↓ и ИТОГ' : 'ВВОД', this.entry, { active: !this.removeMode, size: 22, placeholder: '0.00' });
    if (pos.qtyMilli !== null) {
      g.rrect(rx, ly + 158, rw, 26, 6, C.panel2, C.info);
      g.text(`Количество × ${fmtQty(pos.qtyMilli)}`, rx + rw / 2, ly + 171, { size: 13, weight: 700, color: C.info, align: 'center' });
    } else if (t.taxes.length) {
      g.text(t.taxes.map((x) => `${x.name}: ${money(x.amount)}`).join(' · '), rx + 4, ly + 172, { size: 10, color: C.dim, maxW: rw - 8 });
    }
    const cs = this.app.db.currentCashier();
    g.icon('user', rx + 2, ly + lh - 18, 14, C.dim);
    g.text(`Кассир ${cs.id}: ${cs.name}`, rx + 20, ly + lh - 11, { size: 11, color: C.muted, maxW: rw - 24 });
  }
}

/** Количество для весового/любого товара перед добавлением. */
export function qtyPrompt(app, product, onDone) {
  return new NumberPrompt(app, {
    title: product.name, icon: 'package', label: product.weighted ? 'Вес, кг' : 'Количество, шт', kind: product.weighted ? 'qty' : 'int', maxLen: 8,
    extra: (g, x, y, w) => {
      g.text(`Код ${product.code}`, x, y + 8, { size: 12, color: C.muted });
      g.text(`${money(product.price)} ₽${product.weighted ? ' / кг' : ''}`, x + w, y + 8, { size: 16, weight: 700, align: 'right' });
    },
    onOk: (v) => {
      const res = app.pos.setQty(v || '1');
      if (res.error) return res.error;
      const add = app.pos.addProduct(product);
      if (add.error) return add.error;
      app.pop();
      onDone?.();
      app.toast(`+ ${product.name}`);
      return null;
    },
  });
}

export class SearchScreen extends Screen {
  constructor(app, query = '') {
    super(app);
    this.query = query;
    this.list = new ListView();
  }
  get title() { return 'Поиск товара по коду'; }
  get icon() { return 'search'; }
  softkeys() { return ['Добавить', 'Кол-во', null, null]; }
  results() { return searchProducts(this.app.db.products, this.query); }

  add(withQty) {
    const p = this.results()[this.list.sel];
    if (!p) { this.app.toast('Нет товаров', 'error'); return; }
    if (withQty || p.weighted) { this.app.push(qtyPrompt(this.app, p, () => this.app.pop())); return; }
    const res = this.app.pos.addProduct(p);
    if (res.error) { this.app.toast(res.error, 'error'); return; }
    this.app.pop();
    this.app.toast(`+ ${p.name}`);
  }

  onKey(id) {
    if (/^d\d$/.test(id) || id === 'd00') { this.query = (this.query + keyChar(id)).slice(0, 14); this.list.sel = 0; return true; }
    switch (id) {
      case 'bs': this.query = this.query.slice(0, -1); this.list.sel = 0; return true;
      case 'clr': if (this.query) { this.query = ''; this.list.sel = 0; } else this.app.pop(); return true;
      case 'up': this.list.move(-1, this.results().length); return true;
      case 'down': this.list.move(1, this.results().length); return true;
      case 'ok': case 'm1': case 'code': this.add(false); return true;
      case 'mul': case 'm2': this.add(true); return true;
    }
    return true;
  }

  drawBody(g) {
    const x = 6, w = W - 12;
    g.rrect(x, BODY_Y + 4, w, 32, 6, C.panel2, C.accent);
    g.icon('search', x + 8, BODY_Y + 12, 16, C.muted);
    g.text(this.query || 'введите код или штрихкод', x + 32, BODY_Y + 20, { size: 15, weight: 700, color: this.query ? C.text : C.dim });
    const res = this.results();
    g.text(`${res.length} найдено`, x + w - 8, BODY_Y + 20, { size: 11, color: C.muted, align: 'right' });
    if (!res.length) { g.text('Ничего не найдено', W / 2, BODY_Y + 110, { size: 14, color: C.muted, align: 'center' }); return; }
    this.list.draw(g, res, x + 2, BODY_Y + 42, w - 10, BODY_H - 46, 28, (g2, p, i, rx, ry, rw, rh) => {
      const exact = p.code === this.query;
      g2.text(p.code, rx + 8, ry + rh / 2, { size: 13, weight: 800, color: exact ? C.accent : C.info });
      g2.text(p.name, rx + 90, ry + rh / 2, { size: 13, weight: 600, maxW: rw - 210 });
      if (p.weighted) g2.text('кг', rx + rw - 110, ry + rh / 2, { size: 11, color: C.muted });
      g2.text(money(p.price, { group: true }), rx + rw - 8, ry + rh / 2, { size: 13, weight: 700, align: 'right' });
    });
  }
}

/** Скидка/надбавка: значение, М1 = %, М2 = ₽, «−» переключает скидку/надбавку. */
export function discountPrompt(app, initial = '') {
  let kind = 'discount';
  const pr = new NumberPrompt(app, {
    title: 'Скидка на чек', icon: 'percent', label: 'Значение', value: initial, kind: 'money', maxLen: 8,
    soft: () => ['%', '₽', null, kind === 'discount' ? '−: надбавка' : '−: скидка'],
    extra: (g, x, y, w) => {
      g.rrect(x, y, w, 56, 8, C.panel, kind === 'discount' ? C.ok : C.accent);
      g.text(kind === 'discount' ? 'СКИДКА' : 'НАДБАВКА', x + 14, y + 20, { size: 18, weight: 800, color: kind === 'discount' ? C.ok : C.accent });
      g.text(`сумма чека ${money(app.pos.totals().total)} ₽`, x + w - 14, y + 20, { size: 13, color: C.muted, align: 'right' });
      g.text('значение, затем М1 — проценты или М2 — рубли', x + 14, y + 42, { size: 11, color: C.dim });
    },
    onMinus: () => { kind = kind === 'discount' ? 'markup' : 'discount'; pr.pTitle = kind === 'discount' ? 'Скидка на чек' : 'Надбавка на чек'; },
    onOk: () => 'Выберите М1 (%) или М2 (₽)',
    onSoft: (i, v) => {
      if (i > 1) return null;
      const res = app.pos.addAdjustment(kind, i === 0 ? 'pct' : 'abs', v);
      if (res.error) return res.error;
      app.pop();
      app.toast(kind === 'discount' ? 'Скидка добавлена' : 'Надбавка добавлена');
      return null;
    },
  });
  return pr;
}

export class PaymentScreen extends Screen {
  constructor(app, initial = '') {
    super(app);
    this.entry = initial;
  }
  get title() { return 'Оплата'; }
  get icon() { return 'wallet'; }
  softkeys() { return ['Наличные', 'Карта', null, null]; }

  pay(method) {
    const pos = this.app.pos;
    const ev = pos.evaluate(method, this.entry);
    const name = method === 'cash' ? 'наличными' : 'картой';
    const apply = (payment) => {
      const rem = pos.addPayment(payment);
      this.entry = '';
      if (payment.change > 0) { this.app.replace(new ChangeScreen(this.app, payment)); return; }
      if (rem <= 0) { this.complete(); return; }
      this.app.toast(`Оплачено ${name} ${money(payment.amount)}. Осталось ${money(rem)}`);
    };
    switch (ev.kind) {
      case 'confirm_full':
        this.app.push(new Dialog(this.app, {
          kind: 'confirm', title: 'Сумма не введена', text: `Уверены? Оплатить ${money(ev.amount)} ₽ ${name} полностью.`,
          onYes: () => apply(method === 'cash' ? { method, amount: ev.amount, tendered: ev.amount, change: 0 } : { method, amount: ev.amount }),
        }));
        break;
      case 'warn_partial':
        this.app.push(new Dialog(this.app, {
          kind: 'confirm', title: 'Частичная оплата картой',
          text: `Картой ${money(ev.payment.amount)} ₽. Останется ${money(pos.totals().remaining - ev.payment.amount)} ₽ — можно оплатить другой картой или наличными.`,
          onYes: () => apply(ev.payment),
        }));
        break;
      case 'error':
        this.app.push(new Dialog(this.app, { kind: 'error', title: 'Оплата невозможна', text: pos.errorText(ev.code) }));
        break;
      case 'ok': apply(ev.payment); break;
    }
  }

  complete() {
    const doc = this.app.pos.finish();
    this.app.pop();
    this.app.toast(`Чек № ${fmtDocNo(doc.no)} закрыт`, 'ok');
  }

  onKey(id) {
    if (isDigitKey(id)) { this.entry = editEntry(this.entry, id, 10); return true; }
    switch (id) {
      case 'bs': this.entry = this.entry.slice(0, -1); return true;
      case 'clr': if (this.entry) this.entry = ''; else this.app.pop(); return true;
      case 'm1': this.pay('cash'); return true;
      case 'm2': this.pay('card'); return true;
      case 'ok': this.app.toast('М1 — наличные, М2 — карта'); return true;
    }
    return true;
  }

  drawBody(g) {
    const t = this.app.pos.totals();
    const x = 10, w = W - 20;
    const card = (cx, label, val, color) => {
      g.rrect(cx, BODY_Y + 6, 148, 64, 8, C.panel);
      g.text(label, cx + 10, BODY_Y + 20, { size: 11, weight: 700, color: C.muted });
      g.text(money(val, { group: true }), cx + 138, BODY_Y + 50, { size: 20, weight: 800, color, align: 'right', maxW: 128 });
    };
    card(x, 'К ОПЛАТЕ', t.total, C.text);
    card(x + 156, 'ОПЛАЧЕНО', t.paid, C.ok);
    card(x + 312, 'ОСТАЛОСЬ', t.remaining, C.accent);
    drawField(g, x, BODY_Y + 78, 300, 'ВНОСИМАЯ СУММА', this.entry, { size: 24, placeholder: money(t.remaining) });
    // список оплат
    const pays = this.app.pos.receipt.payments;
    g.text('Оплаты', x + 312, BODY_Y + 84, { size: 11, color: C.muted, baseline: 'top' });
    if (!pays.length) g.text('—', x + 312, BODY_Y + 108, { size: 13, color: C.dim });
    pays.slice(-4).forEach((p, i) => {
      g.icon(p.method === 'cash' ? 'banknote' : 'credit-card', x + 312, BODY_Y + 100 + i * 20, 14, C.muted);
      g.text(money(p.amount), x + w, BODY_Y + 107 + i * 20, { size: 12, weight: 700, align: 'right' });
    });
    g.text('Без суммы — оплата всего остатка · наличные: можно больше (сдача) · карта: можно часть', W / 2, BODY_Y + 168, { size: 10, color: C.dim, align: 'center', maxW: W - 20 });
  }
}

/** Сдача: держится до повторного ИТОГ, затем чек закрывается и печатается. */
export class ChangeScreen extends Screen {
  constructor(app, payment) { super(app); this.payment = payment; }
  get title() { return 'Сдача'; }
  get icon() { return 'hand-coins'; }
  softkeys() { return [null, null, null, null]; }
  onKey(id) {
    if (id === 'ok') {
      const doc = this.app.pos.finish();
      this.app.pop();
      this.app.toast(`Чек № ${fmtDocNo(doc.no)} закрыт`, 'ok');
    }
    return true;
  }
  drawBody(g) {
    g.text('СДАЧА', W / 2, BODY_Y + 36, { size: 16, weight: 800, color: C.muted, align: 'center' });
    g.text(`${money(this.payment.change, { group: true })} ₽`, W / 2, BODY_Y + 96, { size: 56, weight: 800, color: C.ok, align: 'center' });
    g.text(`получено ${money(this.payment.tendered)} · к оплате ${money(this.payment.amount)}`, W / 2, BODY_Y + 146, { size: 13, color: C.muted, align: 'center' });
    g.rrect(W / 2 - 110, BODY_Y + 168, 220, 32, 8, C.accent);
    g.text('ИТОГ — завершить', W / 2, BODY_Y + 184, { size: 14, weight: 800, color: '#1a1405', align: 'center' });
  }
}

export class BigTotalScreen extends Screen {
  get title() { return 'Итог'; }
  get icon() { return 'receipt'; }
  onKey() { this.app.pop(); return true; }
  drawBody(g) {
    const t = this.app.pos.totals();
    g.text('К ОПЛАТЕ', W / 2, BODY_Y + 44, { size: 18, weight: 800, color: C.muted, align: 'center' });
    g.text(`${money(t.remaining, { group: true })} ₽`, W / 2, BODY_Y + 110, { size: 60, weight: 800, color: C.accent, align: 'center' });
    g.text(`позиций: ${this.app.pos.receipt.items.length} · любая клавиша — назад`, W / 2, BODY_Y + 170, { size: 12, color: C.dim, align: 'center' });
  }
}

export class BalanceScreen extends Screen {
  get title() { return 'Баланс кассы'; }
  get icon() { return 'banknote'; }
  softkeys() { return [null, null, null, 'Назад']; }
  onKey(id) { if (id === 'clr' || id === 'ok' || id === 'm4') this.app.pop(); return true; }
  drawBody(g) {
    const r = this.app.journal.report(this.app.epoch());
    const rows = [
      ['В кассе (наличные)', r.inDrawer, C.ok], ['Выручка наличными', r.salesCash], ['Выручка картой', r.salesCard],
      ['Внесено', r.cashIn], ['Выплачено', r.cashOut], ['Возвраты', r.returnsSum], ['Итог смены', r.net, C.accent],
    ];
    rows.forEach(([k, v, color], i) => {
      const y = BODY_Y + 18 + i * 28;
      g.text(k, 40, y, { size: 14, color: C.muted });
      g.text(money(v, { group: true }), W - 40, y, { size: i === 0 ? 18 : 15, weight: 800, color: color ?? C.text, align: 'right' });
      g.hline(40, y + 13, W - 80);
    });
  }
}

/** Возврат: номер чека -> просмотр -> подтверждение. */
export function returnNumberPrompt(app) {
  return new NumberPrompt(app, {
    title: 'Возврат чека', icon: 'undo-2', label: 'Сквозной номер чека', kind: 'int', maxLen: 6,
    extra: (g, x, y, w) => {
      const last = app.journal.lastSale();
      g.text('Чек будет полностью аннулирован', x, y + 8, { size: 13, color: C.muted });
      if (last) g.text(`последний чек: № ${fmtDocNo(last.no)}`, x + w, y + 8, { size: 12, color: C.dim, align: 'right' });
    },
    onOk: (v) => {
      const res = app.pos.findForReturn(v);
      if (res.error) return res.error;
      app.replace(new ReturnPreview(app, res.doc));
      return null;
    },
  });
}

export class ReturnPreview extends Screen {
  constructor(app, doc) { super(app); this.doc = doc; this.list = new ListView(); }
  get title() { return `Возврат чека № ${fmtDocNo(this.doc.no)}`; }
  get icon() { return 'undo-2'; }
  softkeys() { return ['Вернуть', null, null, 'Отмена']; }
  onKey(id) {
    if (id === 'up') this.list.move(-1, this.doc.items.length);
    else if (id === 'down') this.list.move(1, this.doc.items.length);
    else if (id === 'clr' || id === 'm4') this.app.pop();
    else if (id === 'ok' || id === 'm1') {
      this.app.push(new Dialog(this.app, {
        kind: 'confirm', title: 'Вернуть чек полностью?', text: `Чек № ${fmtDocNo(this.doc.no)} на ${money(this.doc.totals.total)} ₽`,
        onYes: () => {
          const res = this.app.pos.returnSale(this.doc.no);
          this.app.pop();
          this.app.toast(res.error ? 'Ошибка возврата' : `Возврат оформлен, док. № ${fmtDocNo(res.doc.no)}`, res.error ? 'error' : 'ok');
        },
      }));
    }
    return true;
  }
  drawBody(g) {
    const d = this.doc;
    g.text(`${fmtDateTime(d.at)} · ${d.cashier}`, 10, BODY_Y + 14, { size: 12, color: C.muted });
    g.text(`${money(d.totals.total, { group: true })} ₽`, W - 10, BODY_Y + 16, { size: 20, weight: 800, color: C.accent, align: 'right' });
    this.list.draw(g, d.items, 8, BODY_Y + 34, W - 20, BODY_H - 64, 26, (g2, it, i, x, y, w, h) => {
      g2.text(it.name, x + 6, y + h / 2, { size: 13, maxW: w - 160 });
      g2.text(`${fmtQty(it.qtyMilli, it.weighted)} × ${money(it.price)}`, x + w - 6, y + h / 2, { size: 12, color: C.muted, align: 'right' });
    }, { showSel: false });
    const pays = d.payments.map((p) => `${p.method === 'cash' ? 'нал.' : 'карта'} ${money(p.amount)}`).join(' · ');
    g.text(`Оплата: ${pays}`, 10, BODY_Y + BODY_H - 14, { size: 12, color: C.muted, maxW: W - 20 });
  }
}

/** Внесение / выплата. */
export function cashPrompt(app, dir, initial = '') {
  return new NumberPrompt(app, {
    title: dir === 'in' ? 'Внесение в кассу' : 'Выплата из кассы', icon: dir === 'in' ? 'plus' : 'minus',
    label: 'Сумма', value: initial, kind: 'money', maxLen: 9,
    extra: (g, x, y, w) => {
      g.text('В кассе сейчас', x, y + 8, { size: 13, color: C.muted });
      g.text(`${money(app.journal.cashInDrawer(), { group: true })} ₽`, x + w, y + 8, { size: 16, weight: 700, align: 'right' });
    },
    onOk: (v) => {
      const res = app.pos.cashOp(dir, v);
      if (res.error) return res.error;
      app.pop();
      app.toast(dir === 'in' ? 'Внесение оформлено' : 'Выплата оформлена', 'ok');
      return null;
    },
  });
}

/** Выбор кассира при входе в кассовый режим (до 8 кассиров). */
export class CashierSelect extends Screen {
  constructor(app) {
    super(app);
    this.list = new ListView();
    const act = app.db.activeCashiers();
    this.list.sel = Math.max(0, act.findIndex((c) => c.id === app.db.currentCashier().id));
  }
  get title() { return 'Кто за кассой?'; }
  get icon() { return 'user'; }
  softkeys() { return ['Выбрать', null, null, null]; }
  onKey(id) {
    const act = this.app.db.activeCashiers();
    if (id === 'up') this.list.move(-1, act.length);
    else if (id === 'down') this.list.move(1, act.length);
    else if (/^d[1-8]$/.test(id)) { const i = act.findIndex((c) => c.id === Number(id[1])); if (i >= 0) { this.list.sel = i; this.choose(); } }
    else if (id === 'ok' || id === 'm1') this.choose();
    else if (id === 'clr') this.app.pop();
    return true;
  }
  choose() {
    const c = this.app.db.activeCashiers()[this.list.sel];
    if (!c) return;
    this.app.db.setCurrentCashier(c.id);
    this.app.replace(new SaleScreen(this.app));
    this.app.toast(`Кассир ${c.id}: ${c.name}`);
  }
  drawBody(g) {
    const act = this.app.db.activeCashiers();
    this.list.draw(g, act, 40, BODY_Y + 10, W - 94, BODY_H - 20, 32, (g2, c, i, x, y, w, h, sel) => {
      g2.icon('user', x + 10, y + 8, 16, sel ? C.accent : C.muted);
      g2.text(`Кассир ${c.id}`, x + 36, y + h / 2, { size: 12, weight: 800, color: C.info });
      g2.text(c.name, x + 120, y + h / 2, { size: 15, weight: 700, maxW: w - 130 });
    });
  }
}
