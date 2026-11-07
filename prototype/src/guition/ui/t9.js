// Ввод текста «как на старых телефонах»: 1–9 и 00 — мультитап, «.» — смена раскладки,
// «0» — регистр (один символ → постоянно → выкл), ←/→ — курсор, ⌫ — стереть. Чистая логика.

export const LAYOUTS = [
  {
    id: 'ru', name: 'РУС', letters: true,
    keys: { 1: '.,?!-:;1', 2: 'абвг2', 3: 'деёжз3', 4: 'ийкл4', 5: 'мноп5', 6: 'рсту6', 7: 'фхцч7', 8: 'шщъы8', 9: 'ьэюя9', '00': ' 0' },
  },
  {
    id: 'en', name: 'ENG', letters: true,
    keys: { 1: '.,?!-:;1', 2: 'abc2', 3: 'def3', 4: 'ghi4', 5: 'jkl5', 6: 'mno6', 7: 'pqrs7', 8: 'tuv8', 9: 'wxyz9', '00': ' 0' },
  },
  {
    id: 'sym', name: 'СИМ', letters: false,
    keys: { 1: '.,:;', 2: '!?¡¿', 3: '"\'«»', 4: '()[]', 5: '+-*/', 6: '=<>%', 7: '@#&_', 8: '$€₽№', 9: '~^|\\', '00': ' ' },
  },
  {
    id: 'num', name: '123', letters: false,
    keys: { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', '00': '0' },
  },
];

export const CAPS = ['abc', 'Abc', 'ABC']; // выкл, один символ, постоянно
export const MULTITAP_MS = 1000;

export class T9Editor {
  constructor(text = '', { maxLen = 48 } = {}) {
    this.text = text;
    this.cursor = text.length;
    this.layout = 0;
    this.caps = 0;
    this.maxLen = maxLen;
    this.pending = null; // {key, idx, at}
  }

  get layoutInfo() { return LAYOUTS[this.layout]; }

  _charFor(key, idx) {
    const set = this.layoutInfo.keys[key];
    let ch = set[idx % set.length];
    if (this.layoutInfo.letters && this.caps > 0) ch = ch.toUpperCase();
    return ch;
  }

  /** Текст с учётом ещё не зафиксированного символа (для отображения). */
  display() {
    if (!this.pending) return { text: this.text, cursor: this.cursor, pendingAt: -1 };
    const ch = this._charFor(this.pending.key, this.pending.idx);
    return { text: this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor), cursor: this.cursor + 1, pendingAt: this.cursor };
  }

  commit() {
    if (!this.pending) return;
    const ch = this._charFor(this.pending.key, this.pending.idx);
    this.pending = null;
    if (this.text.length >= this.maxLen) return;
    this.text = this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor);
    this.cursor++;
    if (this.caps === 1 && /\p{L}/u.test(ch)) this.caps = 0;
  }

  /** Вызывать периодически: фиксирует символ после паузы. */
  tick(now) { if (this.pending && now - this.pending.at >= MULTITAP_MS) this.commit(); }

  /** @param {string} id идентификатор клавиши (d0..d9, d00, dot, left, right, bs) @returns {boolean} обработано */
  key(id, now) {
    if (/^d[1-9]$/.test(id) || id === 'd00') {
      const k = id === 'd00' ? '00' : id.slice(1);
      if (this.pending && this.pending.key === k && now - this.pending.at < MULTITAP_MS) {
        this.pending.idx++;
        this.pending.at = now;
      } else {
        this.commit();
        this.pending = { key: k, idx: 0, at: now };
      }
      return true;
    }
    switch (id) {
      case 'd0': this.commit(); this.caps = (this.caps + 1) % 3; return true;
      case 'dot': this.commit(); this.layout = (this.layout + 1) % LAYOUTS.length; return true;
      case 'left': this.commit(); this.cursor = Math.max(0, this.cursor - 1); return true;
      case 'right': this.commit(); this.cursor = Math.min(this.text.length, this.cursor + 1); return true;
      case 'bs':
        if (this.pending) { this.pending = null; return true; }
        if (this.cursor > 0) { this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor); this.cursor--; }
        return true;
    }
    return false;
  }

  /** Финальный текст (с фиксацией). */
  value() { this.commit(); return this.text; }
}
