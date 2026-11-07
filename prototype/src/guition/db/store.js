// База кассы: товары, 2 налога, магазин (название, шапка, подвал), кассир, настройки.
// Хранится через HAL storage (в браузере — localStorage, на железе — файл на flash/SD).

export const DB_VERSION = 2;
export const MAX_CASHIERS = 8;
export const MAX_SECTIONS = 16;

/** Состояние секции (как у Меркурия): продажи / услуги / закрыта. */
export const SECTION_STATES = [{ value: 'sale', label: 'Товары' }, { value: 'service', label: 'Услуги' }, { value: 'closed', label: 'Закрыта' }];

function defaultSections() {
  const named = {
    1: { state: 'sale', name: 'Кулинария', taxId: 1, limit: 0 },
    2: { state: 'sale', name: 'Напитки', taxId: 1, limit: 0 },
    3: { state: 'sale', name: 'Бакалея', taxId: 2, limit: 0 },
    13: { state: 'service', name: 'Доставка', taxId: 0, limit: 20000 },
  };
  return Array.from({ length: MAX_SECTIONS }, (_, i) => ({ n: i + 1, ...(named[i + 1] ?? { state: 'closed', name: '', taxId: 0, limit: 0 }) }));
}

function defaultCashiers() {
  return Array.from({ length: MAX_CASHIERS }, (_, i) => ({ id: i + 1, name: ['Иванова М.', 'Петров С.'][i] ?? '' }));
}

export function defaultDb() {
  return {
    version: DB_VERSION,
    products: [
      { code: '1', name: 'Кофе американо', weighted: false, price: 18000, taxId: 1, section: 2, barcode: '' },
      { code: '2', name: 'Чай чёрный', weighted: false, price: 12000, taxId: 1, section: 2, barcode: '' },
      { code: '12', name: 'Круассан', weighted: false, price: 9500, taxId: 1, section: 1, barcode: '' },
      { code: '123', name: 'Вода 0,5 л', weighted: false, price: 6000, taxId: 1, section: 2, barcode: '4601234567890' },
      { code: '1234', name: 'Сок яблочный', weighted: false, price: 14000, taxId: 1, section: 2, barcode: '' },
      { code: '123555', name: 'Сок апельсиновый', weighted: false, price: 15000, taxId: 1, section: 2, barcode: '' },
      { code: '50', name: 'Яблоки', weighted: true, price: 15900, taxId: 2, section: 3, barcode: '' },
      { code: '51', name: 'Сыр российский', weighted: true, price: 89000, taxId: 2, section: 3, barcode: '' },
      { code: '700', name: 'Пакет', weighted: false, price: 1000, taxId: 0, section: 3, barcode: '' },
    ],
    taxes: [
      { id: 1, name: 'НДС 20%', rate: 2000, mode: 'incl' },
      { id: 2, name: 'НДС 10%', rate: 1000, mode: 'incl' },
    ],
    shop: {
      name: 'ЛАВКА «КОССА»',
      header: ['г. Москва, ул. Примерная, 1', 'Тел. +7 900 000-00-00'],
      footer: ['Спасибо за покупку!', 'Ждём вас снова'],
    },
    cashiers: defaultCashiers(),
    sections: defaultSections(),
    settings: {
      heat: 1, // 0 низкий, 1 норм, 2 высокий
      feedAfter: 4,
      qr: true,
      sound: true,
      brightness: 100,
      cashierId: 1, // кто сейчас за кассой
      defaultSection: 1, // секция для цены + ИТОГ
    },
  };
}

export const HEAT_LEVELS = [
  { name: 'Низкий', n1: 5, n2: 80, n3: 40 },
  { name: 'Нормальный', n1: 7, n2: 120, n3: 40 },
  { name: 'Высокий', n1: 9, n2: 160, n3: 40 },
];

export class Store {
  /** @param {{load:(k:string)=>any, save:(k:string,v:any)=>void}} storage */
  constructor(storage) {
    this.storage = storage;
    this.data = null;
  }

  /** @returns {{created:boolean}} */
  load() {
    const d = migrate(this.storage.load('db'));
    if (d && d.version === DB_VERSION && Array.isArray(d.products) && Array.isArray(d.taxes)) {
      this.data = d;
      return { created: false };
    }
    this.data = defaultDb();
    this.save();
    return { created: true };
  }

  save() { this.storage.save('db', this.data); }
  reset() { this.data = defaultDb(); this.save(); }

  get products() { return this.data.products; }
  get taxes() { return this.data.taxes; }
  get shop() { return this.data.shop; }
  get settings() { return this.data.settings; }
  get cashiers() { return this.data.cashiers; }
  get sections() { return this.data.sections; }
  /** Активные кассиры — с непустым именем. */
  activeCashiers() { return this.cashiers.filter((c) => c.name.trim()); }
  currentCashier() {
    return this.cashiers.find((c) => c.id === this.settings.cashierId && c.name.trim()) ?? this.activeCashiers()[0] ?? this.cashiers[0];
  }
  setCurrentCashier(id) { this.settings.cashierId = id; this.save(); }
  /** Имя текущего кассира (для чеков и экранов). */
  get cashier() { return this.currentCashier().name; }
  section(n) { return this.sections.find((x) => x.n === n) ?? null; }
  openSections() { return this.sections.filter((x) => x.state !== 'closed'); }
  /** «СК2 Напитки» */
  sectionLabel(n) { const x = this.section(n); return x?.name ? `${n} ${x.name}` : String(n); }

  /** Можно ли продать по цене в секцию. @returns {string|null} ошибка */
  checkSection(n, price) {
    const x = this.section(n);
    if (!x) return `Нет секции ${n}`;
    if (x.state === 'closed') return `Секция ${n} закрыта`;
    if (x.limit > 0 && price > x.limit) return `Цена выше лимита секции ${n}`;
    return null;
  }

  taxById(id) { return this.taxes.find((t) => t.id === id) ?? null; }
  findByCode(code) { return this.products.find((p) => p.code === code) ?? null; }

  /** Проверка товара. @returns {string|null} ошибка */
  validate(p, originalCode = null) {
    if (!p.name.trim()) return 'Пустое название';
    if (!/^\d{1,13}$/.test(p.code)) return 'Код: 1–13 цифр';
    if (p.code !== originalCode && this.findByCode(p.code)) return `Код ${p.code} уже занят`;
    if (!(p.price >= 0)) return 'Неверная цена';
    if (p.barcode && !/^\d{8,14}$/.test(p.barcode)) return 'Штрихкод: 8–14 цифр';
    if (!this.section(p.section)) return 'Неверная секция';
    return null;
  }

  upsertProduct(p, originalCode = null) {
    const err = this.validate(p, originalCode);
    if (err) return err;
    const i = originalCode === null ? -1 : this.products.findIndex((x) => x.code === originalCode);
    if (i >= 0) this.products[i] = { ...p };
    else this.products.push({ ...p });
    this.products.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
    this.save();
    return null;
  }

  deleteProduct(code) {
    const i = this.products.findIndex((x) => x.code === code);
    if (i >= 0) { this.products.splice(i, 1); this.save(); }
  }

  nextFreeCode() {
    let n = 1;
    const used = new Set(this.products.map((p) => p.code));
    while (used.has(String(n))) n++;
    return String(n);
  }
}

/** Миграция базы со старых версий: v1 -> v2 (кассиры, секции). */
export function migrate(d) {
  if (!d || typeof d !== 'object') return d;
  if (d.version === 1) {
    const cashiers = defaultCashiers().map((c) => ({ ...c, name: '' }));
    cashiers[0].name = d.cashier || 'Кассир 1';
    delete d.cashier;
    d.cashiers = cashiers;
    d.sections = defaultSections();
    d.products.forEach((p) => { p.section ??= 1; });
    d.settings = { ...d.settings, cashierId: 1, defaultSection: 1 };
    d.version = 2;
  }
  return d;
}

/** In-memory storage для тестов. */
export function memoryStorage() {
  const m = new Map();
  return { load: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), save: (k, v) => m.set(k, JSON.stringify(v)) };
}
