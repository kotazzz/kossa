// Раскладка 32 клавиш (две мембраны 4x4: строки 0..7, столбцы 0..3), код = row*4 + col.
// Верхний блок — функции и навигация, нижний — цифровой блок. icon — имя иконки Lucide для панели.

export const KEYS = [
  { id: 'm1', label: 'М1', kind: 'soft' }, { id: 'm2', label: 'М2', kind: 'soft' }, { id: 'm3', label: 'М3', kind: 'soft' }, { id: 'm4', label: 'М4', kind: 'soft' },
  { id: 'code', label: 'Код', icon: 'search', kind: 'fn' }, { id: 'ret', label: 'Возврат', icon: 'undo-2', kind: 'fn' }, { id: 'menu', label: 'Меню', icon: 'layout-grid', kind: 'fn' }, { id: 'annul', label: 'Аннул.', icon: 'ban', kind: 'warn' },
  { id: 'minus', label: '−', icon: 'minus', kind: 'nav' }, { id: 'up', label: '↑', icon: 'arrow-up', kind: 'nav' }, { id: 'plus', label: '+', icon: 'plus', kind: 'nav' }, { id: 'disc', label: 'Скидка', icon: 'percent', kind: 'fn' },
  { id: 'left', label: '←', icon: 'arrow-left', kind: 'nav' }, { id: 'down', label: '↓', icon: 'arrow-down', kind: 'nav' }, { id: 'right', label: '→', icon: 'arrow-right', kind: 'nav' }, { id: 'pay', label: 'Оплата', icon: 'wallet', kind: 'ok' },
  { id: 'd7', label: '7' }, { id: 'd8', label: '8' }, { id: 'd9', label: '9' }, { id: 'bs', label: '⌫', icon: 'delete', kind: 'fn' },
  { id: 'd4', label: '4' }, { id: 'd5', label: '5' }, { id: 'd6', label: '6' }, { id: 'clr', label: 'C', kind: 'warn' },
  { id: 'd1', label: '1' }, { id: 'd2', label: '2' }, { id: 'd3', label: '3' }, { id: 'mul', label: '×', icon: 'x', kind: 'fn' },
  { id: 'd0', label: '0' }, { id: 'd00', label: '00' }, { id: 'dot', label: '.' }, { id: 'ok', label: 'ИТОГ', icon: 'corner-down-left', kind: 'ok' },
];

export const codeOf = (id) => KEYS.findIndex((k) => k.id === id);
