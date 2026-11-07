// Вёрстка печатных документов (чек, возврат, аннуляция, внесение/выплата, X/Z, отчёты) на 32 колонки.
import { PageBuilder, pair } from '../receipt.js';
import { money, fmtQty, fmtPct, fmtDateTime, fmtDocNo } from '../pos/format.js';

const COLS = 32;
const PAY_NAMES = { cash: 'НАЛИЧНЫМИ', card: 'КАРТОЙ' };

function header(p, db) {
  p.line(db.shop.name, { align: 'center', scale: 2, bold: true });
  for (const l of db.shop.header) if (l) p.line(l, { align: 'center' });
  p.rule('=');
}

function docLine(p, title, doc, db) {
  p.line(title, { align: 'center', bold: true });
  p.line(pair(`№ ${fmtDocNo(doc.no)}  См. ${doc.shift}`, fmtDateTime(doc.at)));
  p.line(`Кассир${doc.cashierId ? ' ' + doc.cashierId : ''}: ${doc.cashier ?? ''}`.slice(0, COLS));
  p.rule();
}

function footer(p, db) {
  p.rule('=');
  for (const l of db.shop.footer) if (l) p.line(l, { align: 'center' });
  p.line('Не является кассовым чеком', { align: 'center' });
}

const sectionTitle = (db, n) => { const x = db.sections?.find((s) => s.n === n); return `СК${n}${x?.name ? ' ' + x.name.toUpperCase() : ''}`; };

function items(p, doc, db) {
  let lastSection = null;
  doc.items.forEach((it, i) => {
    const sec = it.section ?? 1;
    if (sec !== lastSection) { p.line(sectionTitle(db, sec).slice(0, COLS), { bold: true }); lastSection = sec; } // как «СК2 ХЛЕБНЫЙ» у Меркурия
    p.line(it.name.slice(0, COLS));
    const q = it.weighted ? `${fmtQty(it.qtyMilli, true)} кг` : `${fmtQty(it.qtyMilli)}`;
    p.line(pair(`  ${q} x ${money(it.price)}`, '=' + money(doc.totals.lines?.[i] ?? 0)));
  });
  for (const a of doc.totals.adj ?? []) {
    const name = a.kind === 'discount' ? 'СКИДКА' : 'НАДБАВКА';
    const v = a.mode === 'pct' ? ` ${fmtPct(a.value)}` : '';
    p.line(pair(`${name}${v}`, money(a.amount)));
  }
}

export function qrText(doc, db) {
  return `KOSSA;N=${fmtDocNo(doc.no)};S=${money(doc.totals.total)};D=${fmtDateTime(doc.at)};M=${db.shop.name}`;
}

/** Чек продажи (copy=true — копия). */
export function saleDoc(doc, db, { copy = false } = {}) {
  const p = new PageBuilder();
  header(p, db);
  docLine(p, copy ? 'КОПИЯ ЧЕКА' : 'ПРОДАЖА', doc, db);
  items(p, doc, db);
  p.rule();
  p.line(pair('ИТОГО', '=' + money(doc.totals.total)), { scale: 1, bold: true });
  for (const t of doc.totals.taxes ?? []) p.line(pair(`  в т.ч. ${t.name}`, money(t.amount)));
  p.rule();
  for (const pay of doc.payments) {
    p.line(pair(PAY_NAMES[pay.method], money(pay.amount)));
    if (pay.method === 'cash' && pay.tendered !== undefined) {
      p.line(pair('  ПОЛУЧЕНО', money(pay.tendered)));
      p.line(pair('  СДАЧА', money(pay.change)), { bold: true });
    }
  }
  if (db.settings.qr) { p.blank(8); p.qr(qrText(doc, db)); }
  footer(p, db);
  return p;
}

export function returnDoc(doc, db) {
  const p = new PageBuilder();
  header(p, db);
  docLine(p, 'ВОЗВРАТ ПРОДАЖИ', doc, db);
  p.line(`Аннулирован чек № ${fmtDocNo(doc.ref)}`);
  p.rule();
  items(p, doc, db);
  p.rule();
  p.line(pair('ВОЗВРАТ', '=' + money(doc.totals.total)), { bold: true });
  for (const pay of doc.payments) p.line(pair(`  ${PAY_NAMES[pay.method]}`, money(pay.amount)));
  footer(p, db);
  return p;
}

export function annulDoc(doc, db) {
  const p = new PageBuilder();
  header(p, db);
  docLine(p, 'ЧЕК АННУЛИРОВАН', doc, db);
  items(p, doc, db);
  p.rule();
  p.line(pair('АННУЛИРОВАНО', '=' + money(doc.totals.total)), { bold: true });
  footer(p, db);
  return p;
}

export function cashDoc(doc, db) {
  const p = new PageBuilder();
  header(p, db);
  docLine(p, doc.type === 'cash_in' ? 'ВНЕСЕНИЕ' : 'ВЫПЛАТА', doc, db);
  p.line(pair(doc.type === 'cash_in' ? 'ВНЕСЕНО' : 'ВЫПЛАЧЕНО', '=' + money(doc.amount)), { bold: true });
  footer(p, db);
  return p;
}

/** X- или Z-отчёт по данным journal.report()/closeShift(). */
export function shiftReport(r, db, { z = false } = {}) {
  const p = new PageBuilder();
  header(p, db);
  p.line(z ? 'Z-ОТЧЁТ (ЗАКРЫТИЕ СМЕНЫ)' : 'X-ОТЧЁТ', { align: 'center', bold: true });
  p.line(pair(`Смена № ${r.shiftNo}`, fmtDateTime(r.at)));
  if (r.openedAt) p.line(pair('Открыта', fmtDateTime(r.openedAt)));
  p.line(`Кассир: ${db.cashiers?.find((c) => c.id === db.settings.cashierId)?.name ?? ''}`.slice(0, COLS));
  p.rule();
  const row = (a, b) => p.line(pair(a, money(b)));
  row('НАЛИЧНЫМИ', r.salesCash);
  row('КАРТОЙ', r.salesCard);
  p.line('В ТОМ ЧИСЛЕ');
  row('  СКИДКИ', r.discounts);
  row('  НАДБАВКИ', r.markups);
  row('АННУЛЯЦИИ', r.annulSum);
  row('ВОЗВРАТЫ', r.returnsSum);
  row('  наличными', r.returnsCash);
  row('  картой', r.returnsCard);
  row('ВНЕСЕНО', r.cashIn);
  row('ВЫПЛАЧЕНО', r.cashOut);
  row('В КАССЕ', r.inDrawer);
  for (const t of db.taxes) if (r.taxes[t.id]) row(`НАЛОГ ${t.name}`, r.taxes[t.id]);
  p.rule();
  p.line(pair('ВЫРУЧКА', '=' + money(r.revenue)), { bold: true });
  p.line(pair('ИТОГ (за выч. возвр.)', '=' + money(r.net)), { bold: true });
  p.line(pair('ГРОСС-ИТОГ', money(z ? r.grossAfter : r.gross + r.net)));
  p.rule();
  p.line(pair('ПРОВЕДЕННЫХ ЧЕКОВ', String(r.checks)));
  p.line(pair('АННУЛИРОВАННЫХ', String(r.annulCount)));
  p.line(pair('ВОЗВРАТОВ', String(r.returnsCount)));
  p.line(pair('ПОВТОРНЫХ КОПИЙ', String(r.copies)));
  if (z) { p.rule('='); p.line('СМЕНА ЗАКРЫТА', { align: 'center', bold: true }); }
  p.blank();
  return p;
}

export function itemsReport(r, db) {
  const p = new PageBuilder();
  header(p, db);
  p.line('ОТЧЁТ ПО ТОВАРАМ', { align: 'center', bold: true });
  p.line(pair(`Смена № ${r.shiftNo}`, fmtDateTime(r.at)));
  p.rule();
  const rows = Object.values(r.items).sort((a, b) => b.sum - a.sum);
  if (!rows.length) p.line('Продаж нет', { align: 'center' });
  for (const it of rows) {
    p.line(`${it.code ?? '—'} ${it.name}`.slice(0, COLS));
    p.line(pair(`  ${fmtQty(it.qtyMilli, it.weighted)}${it.weighted ? ' кг' : ' шт'}`, money(it.sum)));
  }
  p.blank();
  return p;
}

export function hourlyReport(r, db) {
  const p = new PageBuilder();
  header(p, db);
  p.line('ПОЧАСОВОЙ ОТЧЁТ', { align: 'center', bold: true });
  p.line(pair(`Смена № ${r.shiftNo}`, fmtDateTime(r.at)));
  p.rule();
  const hours = Object.keys(r.hourly).map(Number).sort((a, b) => a - b);
  if (!hours.length) p.line('Продаж нет', { align: 'center' });
  for (const h of hours) {
    const x = r.hourly[h];
    p.line(pair(`${String(h).padStart(2, '0')}:00  чеков ${x.count}`, money(x.sum)));
  }
  p.blank();
  return p;
}

export function productsList(db) {
  const p = new PageBuilder();
  header(p, db);
  p.line('БАЗА ТОВАРОВ', { align: 'center', bold: true });
  p.rule();
  for (const x of db.products) {
    p.line(`${x.code} ${x.name}`.slice(0, COLS));
    p.line(pair(`  ${x.weighted ? 'весовой' : 'штучный'}`, money(x.price)));
  }
  p.blank();
  return p;
}

/** X/Z-отчёт по кассирам (у кассиров без продаж — только ГРОСС-ИТОГ, как у Меркурия). */
export function cashiersReport(r, db, { z = false } = {}) {
  const p = new PageBuilder();
  header(p, db);
  p.line(`${z ? 'Z' : 'X'}-ОТЧЁТ ПО КАССИРАМ`, { align: 'center', bold: true });
  p.line(fmtDateTime(r.at), { align: 'center' });
  const row = (a, b) => p.line(pair(a, money(b)));
  for (const c of r.rows) {
    p.rule('~');
    p.line(`КАССИР${c.id} ${c.name || ''}`.slice(0, COLS), { bold: true });
    if (c.any) {
      row('НАЛИЧНЫМИ', c.salesCash);
      row('КАРТОЙ', c.salesCard);
      p.line('В ТОМ ЧИСЛЕ');
      row('  СКИДКИ', c.discounts);
      row('  НАДБАВКИ', c.markups);
      row('АННУЛЯЦИИ', c.annulSum);
      row('ВОЗВРАТЫ', c.returnsSum);
      row('ВНЕСЕНО', c.cashIn);
      row('ВЫПЛАТЫ', c.cashOut);
      p.line(pair('ЧЕКОВ', String(c.checks)));
      row('ИТОГО', c.total);
    }
    row('ГРОСС-ИТОГ', z ? c.grossAfter ?? c.gross : c.gross + c.net);
  }
  p.rule();
  if (z) p.line(pair('ГАШЕНИЕ N:', String(r.zNo)), { bold: true });
  p.blank();
  return p;
}

/** X/Z-отчёт по секциям (отделам). */
export function sectionsReport(r, db, { z = false } = {}) {
  const p = new PageBuilder();
  header(p, db);
  p.line(`${z ? 'Z' : 'X'}-ОТЧЁТ ПО ОТДЕЛАМ`, { align: 'center', bold: true });
  p.line(fmtDateTime(r.at), { align: 'center' });
  const row = (a, b) => p.line(pair(a, money(b)));
  for (const x of r.rows) {
    p.rule('~');
    const st = x.state === 'closed' ? ' ЗАКРЫТА' : x.state === 'service' ? ' УСЛУГИ' : '';
    p.line(`СЕКЦИЯ N${x.n}${st}`, { bold: true });
    if (x.name) p.line(x.name.slice(0, COLS));
    if (x.any) {
      row('ПРОДАЖИ', x.sales);
      row('ВОЗВРАТЫ', x.returns);
      p.line(pair('ЧЕКОВ', String(x.count)));
    }
    row('ГРОСС-ИТОГ', z ? x.grossAfter ?? x.gross : x.gross + x.net);
  }
  p.rule();
  if (z) p.line(pair('ГАШЕНИЕ N:', String(r.zNo)), { bold: true });
  p.blank();
  return p;
}

export function cashiersList(db) {
  const p = new PageBuilder();
  header(p, db);
  p.line('КАССИРЫ', { align: 'center', bold: true });
  for (const c of db.cashiers) { p.rule(); p.line(`КАССИР${c.id} ${c.name || '<НАЗВАНИЯ НЕТ>'}`.slice(0, COLS)); }
  p.rule();
  p.blank();
  return p;
}

export function sectionsList(db) {
  const p = new PageBuilder();
  header(p, db);
  p.line('СЕКЦИИ', { align: 'center', bold: true });
  for (const x of db.sections) {
    p.rule();
    p.line(`СЕКЦИЯ N${x.n}: ${{ sale: 'ТОВАРЫ', service: 'УСЛУГИ', closed: 'ЗАКРЫТА' }[x.state]}`);
    p.line((x.name || '<НАЗВАНИЯ НЕТ>').slice(0, COLS));
    const t = db.taxes.find((tt) => tt.id === x.taxId);
    p.line(`НАЛОГ: ${t ? t.name : 'НЕТ'}`.slice(0, COLS));
    p.line(`ОГР.ЦЕНЫ: ${x.limit ? money(x.limit) : 'НЕТ'}`);
  }
  p.rule();
  p.blank();
  return p;
}
