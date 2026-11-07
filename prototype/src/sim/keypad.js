// Модель двух мембранных клавиатур 4x4 без диодов: 8 строк x 4 общих столбца.
// Нажатая клавиша замыкает строку и столбец. Считаем реальную проводимость (в т.ч. «призраки»):
// столбец читается 0, если он электрически связан с строкой, прижатой выходом к земле.
import { PINS, KEY_COLS, KEY_ROWS } from '../common/pins.js';

export class KeypadMatrix {
  constructor() {
    /** @type {Set<number>} коды нажатых клавиш (row*4+col) */
    this.pressed = new Set();
  }

  press(code) { this.pressed.add(code); }
  release(code) { this.pressed.delete(code); }
  isPressed(code) { return this.pressed.has(code); }
  releaseAll() { this.pressed.clear(); }

  /** Вызывается GpioBank для чтения входов. @returns {0|1|undefined} */
  drive(pin, bank) {
    const c = PINS.COLS.indexOf(pin);
    if (c < 0) return undefined;
    // граф: узлы 0..7 — строки, 8..11 — столбцы
    const adj = Array.from({ length: KEY_ROWS + KEY_COLS }, () => []);
    for (const code of this.pressed) {
      const r = (code / KEY_COLS) | 0;
      const cc = code % KEY_COLS;
      adj[r].push(KEY_ROWS + cc);
      adj[KEY_ROWS + cc].push(r);
    }
    const seen = new Array(adj.length).fill(false);
    const stack = [];
    PINS.ROWS.forEach((rp, r) => { if (bank.isDrivenLow(rp)) { seen[r] = true; stack.push(r); } });
    while (stack.length) {
      const n = stack.pop();
      for (const m of adj[n]) if (!seen[m]) { seen[m] = true; stack.push(m); }
    }
    return seen[KEY_ROWS + c] ? 0 : undefined; // иначе подтяжка даст 1
  }
}
