// Правила оплаты (решения пользователя):
// - без суммы: «уверены?» -> оплата всего остатка выбранным способом;
// - карта < остатка: предупреждение, частичная оплата (можно ещё картой — разделение платежа);
// - карта > остатка: ошибка;
// - наличные < остатка: нельзя, «сначала картой»;
// - наличные ≥ остатка: сдача, держится до повторного ИТОГ.

/**
 * @param {{remaining:number}} totals
 * @param {'cash'|'card'} method
 * @param {number|null} amount копейки или null (не введено)
 */
export function evaluatePayment(totals, method, amount) {
  const rem = totals.remaining;
  if (rem <= 0) return { kind: 'error', code: 'nothing_due' };
  if (amount === null) return { kind: 'confirm_full', amount: rem };
  if (!(amount > 0)) return { kind: 'error', code: 'bad_amount' };
  if (method === 'card') {
    if (amount > rem) return { kind: 'error', code: 'card_over' };
    if (amount < rem) return { kind: 'warn_partial', payment: { method, amount } };
    return { kind: 'ok', payment: { method, amount } };
  }
  if (amount < rem) return { kind: 'error', code: 'cash_short' };
  return { kind: 'ok', payment: { method: 'cash', amount: rem, tendered: amount, change: amount - rem } };
}

export const PAYMENT_ERRORS = {
  nothing_due: 'Чек уже оплачен',
  bad_amount: 'Неверная сумма',
  card_over: 'Сумма картой больше остатка',
  cash_short: 'Наличных меньше остатка. Сначала оплатите часть картой',
};
