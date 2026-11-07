// Режимы: отчёты, деньги, база (товары/налоги/магазин/кассир), настройки.
import { W, BODY_Y, BODY_H, C } from '../ui/gfx.js';
import { ListView } from '../ui/widgets.js';
import { Screen, Dialog, TextPrompt } from '../ui/screen.js';
import { MenuList, FormScreen, LinesEditor } from './lists.js';
import { BalanceScreen, cashPrompt } from './sale.js';
import { money, parseMoney, fmtPct, fmtDocNo, fmtDateTime } from '../pos/format.js';
import { searchProducts } from '../db/search.js';
import { HEAT_LEVELS, SECTION_STATES } from '../db/store.js';
import { shiftReport, itemsReport, hourlyReport, productsList, saleDoc, cashiersReport, sectionsReport, cashiersList, sectionsList } from '../print/layout.js';

export function reportsMenu(app) {
  const j = () => app.journal;
  const now = () => app.epoch();
  return new MenuList(app, {
    title: 'Отчёты', icon: 'chart-column',
    items: [
      { label: 'X-отчёт (без гашения)', icon: 'file-chart-column', action: () => { app.printDoc(shiftReport(j().report(now()), app.db.data)); app.toast('X-отчёт печатается'); } },
      {
        label: 'Z-отчёт — закрыть смену', icon: 'ban', action: () => app.push(new Dialog(app, {
          kind: 'confirm', title: 'Закрыть смену?', text: `Смена ${j().shift.no}: итог ${money(j().report(now()).net)} ₽. Счётчики будут обнулены.`,
          onYes: () => { const r = j().closeShift(now()); app.saveJournal(); app.printDoc(shiftReport(r, app.db.data, { z: true })); app.toast(`Смена ${r.shiftNo} закрыта`, 'ok'); },
        })),
      },
      { label: 'Отчёт по товарам', icon: 'package', action: () => { app.printDoc(itemsReport(j().report(now()), app.db.data)); app.toast('Отчёт по товарам печатается'); } },
      { label: 'Почасовой отчёт', icon: 'clock', action: () => { app.printDoc(hourlyReport(j().report(now()), app.db.data)); app.toast('Почасовой отчёт печатается'); } },
      { label: 'X-отчёт по кассирам', icon: 'users', action: () => { app.printDoc(cashiersReport(j().cashierReport(now(), app.db.cashiers), app.db.data)); app.toast('X-отчёт по кассирам печатается'); } },
      {
        label: 'Z-отчёт по кассирам', icon: 'users', action: () => app.push(new Dialog(app, {
          kind: 'confirm', title: 'Гашение по кассирам?', text: 'Счётчики всех кассиров будут обнулены, суммы перейдут в их ГРОСС-ИТОГ. Смена не закрывается.',
          onYes: () => { const r = j().closeCashiers(now(), app.db.cashiers); app.saveJournal(); app.printDoc(cashiersReport(r, app.db.data, { z: true })); app.toast(`Гашение по кассирам № ${r.zNo}`, 'ok'); },
        })),
      },
      { label: 'X-отчёт по секциям', icon: 'layout-grid', action: () => { app.printDoc(sectionsReport(j().sectionReport(now(), app.db.sections), app.db.data)); app.toast('X-отчёт по секциям печатается'); } },
      {
        label: 'Z-отчёт по секциям', icon: 'layout-grid', action: () => app.push(new Dialog(app, {
          kind: 'confirm', title: 'Гашение по секциям?', text: 'Продажи и возвраты всех секций будут обнулены, суммы перейдут в их ГРОСС-ИТОГ. Смена не закрывается.',
          onYes: () => { const r = j().closeSections(now(), app.db.sections); app.saveJournal(); app.printDoc(sectionsReport(r, app.db.data, { z: true })); app.toast(`Гашение по секциям № ${r.zNo}`, 'ok'); },
        })),
      },
      { label: 'Баланс кассы', icon: 'banknote', action: () => app.push(new BalanceScreen(app)) },
      { label: 'Журнал документов', icon: 'list', action: () => app.push(new JournalScreen(app)) },
    ],
  });
}

const DOC_NAMES = { sale: 'Продажа', return: 'Возврат', annul: 'Аннуляция', cash_in: 'Внесение', cash_out: 'Выплата', z: 'Z-отчёт', z_cashiers: 'Z по кассирам', z_sections: 'Z по секциям' };

export class JournalScreen extends Screen {
  constructor(app) { super(app); this.list = new ListView(); this.list.sel = 1e9; }
  get title() { return 'Журнал документов'; }
  get icon() { return 'list'; }
  softkeys() { return ['Копия', null, null, 'Назад']; }
  docs() { return this.app.journal.docs; }
  onKey(id) {
    const d = this.docs()[this.list.sel];
    if (id === 'up') this.list.move(-1, this.docs().length);
    else if (id === 'down') this.list.move(1, this.docs().length);
    else if (id === 'clr' || id === 'm4') this.app.pop();
    else if ((id === 'm1' || id === 'ok') && d) {
      if (d.type !== 'sale') { this.app.toast('Копия — только для чеков продажи', 'error'); return true; }
      this.app.journal.recordCopy(); this.app.saveJournal();
      this.app.printDoc(saleDoc(d, this.app.db.data, { copy: true }));
      this.app.toast(`Копия чека № ${fmtDocNo(d.no)}`);
    }
    return true;
  }
  drawBody(g) {
    const docs = this.docs();
    if (!docs.length) { g.text('Журнал пуст', W / 2, BODY_Y + 100, { size: 14, color: C.muted, align: 'center' }); return; }
    this.list.draw(g, docs, 8, BODY_Y + 6, W - 22, BODY_H - 12, 26, (g2, d, i, x, y, w, h) => {
      g2.text(fmtDocNo(d.no), x + 8, y + h / 2, { size: 12, weight: 800, color: C.info });
      g2.text(DOC_NAMES[d.type] + (d.returned ? ' (возвращён)' : '') + (d.ref ? ` к № ${fmtDocNo(d.ref)}` : ''), x + 60, y + h / 2, { size: 13, maxW: 200 });
      g2.text(fmtDateTime(d.at), x + 290, y + h / 2, { size: 11, color: C.muted });
      const sum = d.totals?.total ?? d.amount ?? d.net;
      if (sum !== undefined) g2.text(money(sum), x + w - 8, y + h / 2, { size: 13, weight: 700, align: 'right' });
    });
  }
}

export function moneyMenu(app) {
  return new MenuList(app, {
    title: 'Деньги', icon: 'hand-coins',
    items: [
      { label: 'Внесение в кассу', icon: 'plus', action: () => app.push(cashPrompt(app, 'in')) },
      { label: 'Выплата из кассы', icon: 'minus', action: () => app.push(cashPrompt(app, 'out')) },
      { label: 'Баланс кассы', icon: 'banknote', value: () => money(app.journal.cashInDrawer(), { group: true }), action: () => app.push(new BalanceScreen(app)) },
    ],
  });
}

// ---------- база ----------
export function dbMenu(app) {
  const db = app.db;
  return new MenuList(app, {
    title: 'База', icon: 'database',
    items: [
      { label: 'Товары', icon: 'package', value: () => String(db.products.length), action: () => app.push(new ProductsScreen(app)) },
      { label: 'Налоги', icon: 'percent', action: () => app.push(taxesMenu(app)) },
      { label: 'Название магазина', icon: 'store', value: () => db.shop.name, action: () => app.push(new TextPrompt(app, { title: 'Магазин', label: 'Название (крупный заголовок, до 16 символов)', value: db.shop.name, maxLen: 16, onOk: (t) => { if (!t.trim()) return 'Пустое название'; db.shop.name = t.trim(); db.save(); app.pop(); return null; } })) },
      { label: 'Шапка чека', icon: 'scroll-text', value: () => `${db.shop.header.length} стр.`, action: () => app.push(new LinesEditor(app, { title: 'Шапка чека', lines: db.shop.header, onChange: (l) => { db.shop.header = l; db.save(); } })) },
      { label: 'Подвал чека', icon: 'scroll-text', value: () => `${db.shop.footer.length} стр.`, action: () => app.push(new LinesEditor(app, { title: 'Подвал чека', lines: db.shop.footer, onChange: (l) => { db.shop.footer = l; db.save(); } })) },
      { label: 'Кассиры', icon: 'users', value: () => `${db.activeCashiers().length} из 8`, action: () => app.push(new CashiersScreen(app)) },
      { label: 'Секции', icon: 'layout-grid', value: () => `${db.openSections().length} откр. из 16`, action: () => app.push(new SectionsScreen(app)) },
      { label: 'Печать базы товаров', icon: 'printer', action: () => { app.printDoc(productsList(db.data)); app.toast('База печатается'); } },
    ],
  });
}

function productForm(app, product, isNew) {
  const db = app.db;
  const taxOptions = [{ value: 0, label: 'Без налога' }, ...db.taxes.map((t) => ({ value: t.id, label: t.name }))];
  return new FormScreen(app, {
    title: isNew ? 'Новый товар' : `Товар ${product.code}`, icon: 'package', obj: product,
    fields: [
      { key: 'name', label: 'Название', type: 'text', maxLen: 32 },
      { key: 'weighted', label: 'Весовой', type: 'bool' },
      { key: 'price', label: 'Цена, ₽', type: 'money', toInput: (v) => (v ? money(v) : ''), fromInput: (s) => parseMoney(s) },
      { key: 'taxId', label: 'Налог', type: 'choice', options: [{ value: 0, label: 'Из секции' }, ...taxOptions.slice(1)] },
      { key: 'section', label: 'Секция', type: 'choice', options: db.sections.map((x) => ({ value: x.n, label: `${x.n}${x.name ? ' ' + x.name : ''}${x.state === 'closed' ? ' (закр.)' : ''}` })) },
      { key: 'code', label: 'Код', type: 'int', maxLen: 13 },
      { key: 'barcode', label: 'Штрихкод', type: 'int', optional: true, maxLen: 14 },
    ],
    fmt: { price: (v) => `${money(v, { group: true })} ₽` },
    onSave: (obj) => db.upsertProduct(obj, isNew ? null : product.code),
  });
}

export class ProductsScreen extends Screen {
  constructor(app) { super(app); this.list = new ListView(); this.query = ''; }
  get title() { return 'Товары'; }
  get icon() { return 'package'; }
  softkeys() { return ['Изменить', null, null, 'Назад']; }
  items() { return this.query ? searchProducts(this.app.db.products, this.query, 500) : this.app.db.products; }
  onKey(id) {
    const items = this.items();
    const p = items[this.list.sel];
    if (/^d\d$/.test(id)) { this.query = (this.query + id[1]).slice(0, 13); this.list.sel = 0; return true; }
    switch (id) {
      case 'bs': this.query = this.query.slice(0, -1); break;
      case 'up': this.list.move(-1, items.length); break;
      case 'down': this.list.move(1, items.length); break;
      case 'plus': this.app.push(productForm(this.app, { code: this.app.db.nextFreeCode(), name: '', weighted: false, price: 0, taxId: 0, section: this.app.db.settings.defaultSection ?? 1, barcode: '' }, true)); break;
      case 'minus':
        if (p) this.app.push(new Dialog(this.app, { kind: 'confirm', title: 'Удалить товар?', text: `${p.code} · ${p.name}`, onYes: () => { this.app.db.deleteProduct(p.code); this.app.toast('Товар удалён'); } }));
        break;
      case 'ok': case 'm1': if (p) this.app.push(productForm(this.app, p, false)); break;
      case 'clr': if (this.query) this.query = ''; else this.app.pop(); break;
      case 'm4': this.app.pop(); break;
    }
    return true;
  }
  drawBody(g) {
    const items = this.items();
    g.text(this.query ? `Код: ${this.query}` : 'Цифры — поиск по коду · + добавить · − удалить', 12, BODY_Y + 12, { size: 11, color: this.query ? C.accent : C.dim });
    if (!items.length) { g.text('Нет товаров', W / 2, BODY_Y + 100, { size: 14, color: C.muted, align: 'center' }); return; }
    this.list.draw(g, items, 8, BODY_Y + 24, W - 22, BODY_H - 28, 28, (g2, p, i, x, y, w, h) => {
      g2.text(p.code, x + 8, y + h / 2, { size: 13, weight: 800, color: C.info });
      g2.text(p.name, x + 90, y + h / 2, { size: 13, weight: 600, maxW: w - 220 });
      if (p.weighted) g2.text('кг', x + w - 112, y + h / 2, { size: 11, color: C.muted });
      g2.text(money(p.price, { group: true }), x + w - 8, y + h / 2, { size: 13, weight: 700, align: 'right' });
    });
  }
}

function taxesMenu(app) {
  const db = app.db;
  return new MenuList(app, {
    title: 'Налоги', icon: 'percent',
    items: db.taxes.map((t, i) => ({
      label: `Налог ${i + 1}`, value: () => `${db.taxes[i].name} · ${fmtPct(db.taxes[i].rate)} · ${db.taxes[i].mode === 'incl' ? 'в цене' : 'сверху'}`,
      action: () => app.push(new FormScreen(app, {
        title: `Налог ${i + 1}`, icon: 'percent', obj: db.taxes[i],
        fields: [
          { key: 'name', label: 'Название', type: 'text', maxLen: 16 },
          { key: 'rate', label: 'Ставка, %', type: 'pct', toInput: (v) => String(v / 100), fromInput: (s) => { const v = parseMoney(s); return v >= 0 && v <= 10000 ? v : null; } },
          { key: 'mode', label: 'Тип', type: 'choice', options: [{ value: 'incl', label: 'Включён в цену' }, { value: 'add', label: 'Начисляется сверху' }] },
        ],
        fmt: { rate: (v) => fmtPct(v) },
        onSave: (obj) => { db.taxes[i] = { ...obj, id: t.id }; db.save(); return null; },
      })),
    })),
  });
}

// ---------- настройки ----------
export function settingsMenu(app) {
  const s = () => app.db.settings;
  const save = () => app.db.save();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return new MenuList(app, {
    title: 'Настройки', icon: 'settings',
    items: [
      { label: 'Нагрев печати', icon: 'printer', value: () => HEAT_LEVELS[s().heat].name, left: () => { s().heat = clamp(s().heat - 1, 0, 2); save(); app.applyPrinterSettings(); }, right: () => { s().heat = clamp(s().heat + 1, 0, 2); save(); app.applyPrinterSettings(); } },
      { label: 'Подача после чека', icon: 'scroll-text', value: () => `${s().feedAfter} строк`, left: () => { s().feedAfter = clamp(s().feedAfter - 1, 0, 9); save(); }, right: () => { s().feedAfter = clamp(s().feedAfter + 1, 0, 9); save(); } },
      { label: 'QR-код на чеке', icon: 'receipt', value: () => (s().qr ? 'Вкл' : 'Выкл'), left: () => { s().qr = !s().qr; save(); }, right: () => { s().qr = !s().qr; save(); } },
      { label: 'Звук клавиш', icon: 'keyboard', value: () => (s().sound ? 'Вкл' : 'Выкл'), left: () => { s().sound = !s().sound; save(); }, right: () => { s().sound = !s().sound; save(); } },
      { label: 'Яркость экрана', icon: 'sliders-horizontal', value: () => `${s().brightness}%`, left: () => { s().brightness = clamp(s().brightness - 10, 20, 100); save(); app.applyBrightness(); }, right: () => { s().brightness = clamp(s().brightness + 10, 20, 100); save(); app.applyBrightness(); } },
      { label: 'Тестовая печать', icon: 'printer', action: () => { app.printTest(); app.toast('Тест печати'); } },
      { label: 'Картинки на SD', icon: 'file-chart-column', value: () => String(app.hal.sd?.list().length ?? 0), action: () => app.push(new ImageViewer(app)) },
      { label: 'Прогон ленты', icon: 'arrow-down', action: () => app.feedPaper() },
      {
        label: 'Сброс всех данных', icon: 'triangle-alert', action: () => app.push(new Dialog(app, {
          kind: 'confirm', title: 'Сбросить данные?', text: 'База товаров, настройки и журнал вернутся к заводским. Действие необратимо.',
          onYes: () => { app.resetAll(); app.toast('Данные сброшены', 'ok'); },
        })),
      },
    ],
  });
}

/** Просмотр картинок с SD: ←→ листать, ИТОГ/М1 — печать с дизерингом. */
export class ImageViewer extends Screen {
  constructor(app) { super(app); this.i = 0; this.cache = new Map(); }
  get title() { const n = this.names(); return n.length ? `${n[this.i]} (${this.i + 1}/${n.length})` : 'Картинки'; }
  get icon() { return 'file-chart-column'; }
  softkeys() { return ['Печать', null, null, 'Назад']; }
  names() { return this.app.hal.sd?.list() ?? []; }
  img() {
    const name = this.names()[this.i];
    if (!name) return null;
    if (!this.cache.has(name)) {
      this.cache.set(name, null);
      this.app.hal.sd.loadImage(name).then((im) => this.cache.set(name, im)).catch(() => this.cache.delete(name));
    }
    return this.cache.get(name);
  }
  onKey(id) {
    const n = this.names().length;
    if (id === 'left' && n) this.i = (this.i + n - 1) % n;
    else if (id === 'right' && n) this.i = (this.i + 1) % n;
    else if (id === 'clr' || id === 'm4') this.app.pop();
    else if ((id === 'ok' || id === 'm1') && this.img()) { this.app.printImage(this.img()); this.app.toast('Картинка печатается'); }
    return true;
  }
  drawBody(g) {
    const im = this.img();
    g.fill(0, BODY_Y, W, BODY_H, '#000');
    if (!this.names().length) { g.text('На SD нет картинок', W / 2, BODY_Y + BODY_H / 2, { size: 14, color: C.muted, align: 'center' }); return; }
    if (!im) { g.text('Загрузка…', W / 2, BODY_Y + BODY_H / 2, { size: 14, color: C.muted, align: 'center' }); return; }
    const k = Math.min(W / im.width, BODY_H / im.height);
    const w = Math.round(im.width * k), h = Math.round(im.height * k);
    this.app.surface.drawImageRGBA(im, Math.round((W - w) / 2), BODY_Y + Math.round((BODY_H - h) / 2), w, h);
  }
}

/** Кассиры: 8 мест; ИТОГ — имя, «−» — освободить место, М1 — печать списка. */
export class CashiersScreen extends Screen {
  constructor(app) { super(app); this.list = new ListView(); }
  get title() { return 'Кассиры'; }
  get icon() { return 'users'; }
  softkeys() { return ['Печать', null, null, 'Назад']; }
  onKey(id) {
    const db = this.app.db;
    const c = db.cashiers[this.list.sel];
    switch (id) {
      case 'up': this.list.move(-1, db.cashiers.length); break;
      case 'down': this.list.move(1, db.cashiers.length); break;
      case 'ok': case 'plus':
        this.app.push(new TextPrompt(this.app, {
          title: `Кассир ${c.id}`, label: 'Имя кассира (до 24 символов)', value: c.name, maxLen: 24,
          onOk: (t) => { if (!t.trim()) return 'Пустое имя — используйте «−»'; c.name = t.trim(); db.save(); this.app.pop(); return null; },
        }));
        break;
      case 'minus':
        if (!c.name) break;
        if (db.activeCashiers().length <= 1) { this.app.toast('Нужен хотя бы один кассир', 'error'); break; }
        this.app.push(new Dialog(this.app, {
          kind: 'confirm', title: `Удалить кассира ${c.id}?`, text: `${c.name}. Его счётчики в отчётах сохранятся.`,
          onYes: () => { c.name = ''; if (db.settings.cashierId === c.id) db.setCurrentCashier(db.activeCashiers()[0].id); db.save(); },
        }));
        break;
      case 'm1': this.app.printDoc(cashiersList(db.data)); this.app.toast('Список кассиров печатается'); break;
      case 'clr': case 'm4': this.app.pop(); break;
    }
    return true;
  }
  drawBody(g) {
    const db = this.app.db;
    this.list.draw(g, db.cashiers, 8, BODY_Y + 6, W - 22, BODY_H - 30, 26, (g2, c, i, x, y, w, h) => {
      g2.text(`Кассир ${c.id}`, x + 10, y + h / 2, { size: 12, weight: 800, color: C.info });
      g2.text(c.name || '— свободно —', x + 100, y + h / 2, { size: 14, weight: 600, color: c.name ? C.text : C.dim, maxW: w - 200 });
      if (c.id === db.currentCashier().id) g2.text('за кассой', x + w - 10, y + h / 2, { size: 11, weight: 700, color: C.ok, align: 'right' });
    });
    g.text('ИТОГ — имя · − — удалить', W / 2, BODY_Y + BODY_H - 12, { size: 11, color: C.dim, align: 'center' });
  }
}

/** Секции (отделы): 16 штук — состояние, название, налог, ограничение цены. */
export class SectionsScreen extends Screen {
  constructor(app) { super(app); this.list = new ListView(); }
  get title() { return 'Секции'; }
  get icon() { return 'layout-grid'; }
  softkeys() { return ['Печать', null, null, 'Назад']; }
  onKey(id) {
    const db = this.app.db;
    const x = db.sections[this.list.sel];
    switch (id) {
      case 'up': this.list.move(-1, db.sections.length); break;
      case 'down': this.list.move(1, db.sections.length); break;
      case 'ok': this.app.push(sectionForm(this.app, x)); break;
      case 'm1': this.app.printDoc(sectionsList(db.data)); this.app.toast('Реквизиты секций печатаются'); break;
      case 'clr': case 'm4': this.app.pop(); break;
    }
    return true;
  }
  drawBody(g) {
    const db = this.app.db;
    this.list.draw(g, db.sections, 8, BODY_Y + 6, W - 22, BODY_H - 12, 26, (g2, x, i, rx, y, w, h) => {
      const closed = x.state === 'closed';
      g2.text(`СК${x.n}`, rx + 10, y + h / 2, { size: 12, weight: 800, color: closed ? C.dim : C.info });
      g2.text(x.name || '<без названия>', rx + 62, y + h / 2, { size: 13, weight: 600, color: closed ? C.dim : C.text, maxW: 170 });
      g2.text(SECTION_STATES.find((s) => s.value === x.state).label, rx + 250, y + h / 2, { size: 11, color: closed ? C.dim : x.state === 'service' ? C.accent : C.ok });
      const tax = db.taxById(x.taxId);
      g2.text(`${tax ? tax.name : 'без налога'}${x.limit ? ' · ≤' + money(x.limit) : ''}`, rx + w - 8, y + h / 2, { size: 11, color: C.muted, align: 'right', maxW: 150 });
    });
  }
}

function sectionForm(app, x) {
  const db = app.db;
  return new FormScreen(app, {
    title: `Секция ${x.n}`, icon: 'layout-grid', obj: x,
    fields: [
      { key: 'state', label: 'Состояние', type: 'choice', options: SECTION_STATES },
      { key: 'name', label: 'Название', type: 'text', optional: true, maxLen: 20 },
      { key: 'taxId', label: 'Налог', type: 'choice', options: [{ value: 0, label: 'Без налога' }, ...db.taxes.map((t) => ({ value: t.id, label: t.name }))] },
      { key: 'limit', label: 'Ограничение цены', type: 'money', toInput: (v) => (v ? money(v) : ''), fromInput: (s) => (s ? parseMoney(s) : 0), optional: true },
    ],
    fmt: { limit: (v) => (v ? `${money(v, { group: true })} ₽` : 'нет') },
    onSave: (obj) => {
      if (obj.state === 'closed' && db.settings.defaultSection === x.n) return 'Это секция по умолчанию — её нельзя закрыть';
      Object.assign(x, obj, { n: x.n, limit: obj.limit || 0 });
      db.save();
      return null;
    },
  });
}
