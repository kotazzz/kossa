// Деньги — целые копейки, количество — тысячные доли (qtyMilli: 1000 = 1 шт или 1 кг).

/** копейки -> «1234.50» (group=true -> «1 234.50») */
export function money(kop, { group = false } = {}) {
  const sign = kop < 0 ? '-' : '';
  const a = Math.abs(Math.round(kop));
  let rub = String(Math.floor(a / 100));
  if (group) rub = rub.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${rub}.${String(a % 100).padStart(2, '0')}`;
}

/** «12», «12.5», «12.50» -> копейки; NaN при ошибке. */
export function parseMoney(s) {
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(s)) return NaN;
  const [r, f = ''] = s.split('.');
  return Number(r) * 100 + Number((f + '00').slice(0, 2));
}

/** «3», «0.35» -> тысячные доли; NaN при ошибке. */
export function parseQty(s) {
  if (!/^\d{1,5}(\.\d{0,3})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  return Number(i) * 1000 + Number((f + '000').slice(0, 3));
}

/** тысячные -> «2» / «0.350» (весовой всегда 3 знака) */
export function fmtQty(qtyMilli, weighted = false) {
  if (!weighted && qtyMilli % 1000 === 0) return String(qtyMilli / 1000);
  return (qtyMilli / 1000).toFixed(3);
}

/** базисные пункты -> «12.5%» */
export function fmtPct(bp) {
  const v = bp / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')) + '%';
}

/** сумма по цене и количеству */
export const lineSum = (price, qtyMilli) => Math.round((price * qtyMilli) / 1000);

const pad = (n) => String(n).padStart(2, '0');
/** epoch ms -> «26.10.2026 18:40» */
export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fmtDocNo = (n) => String(n).padStart(4, '0');
