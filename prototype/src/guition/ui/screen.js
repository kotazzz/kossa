// Базовые экраны: Screen, диалог, ввод числа, ввод текста (T9). Экраны живут в стеке app.screens.
import { W, H, BODY_Y, BODY_H, C } from './gfx.js';
import { drawHeader, drawSoftkeys, drawField } from './widgets.js';
import { T9Editor, LAYOUTS, CAPS } from './t9.js';

export class Screen {
  constructor(app) { this.app = app; this.modal = false; }
  get title() { return ''; }
  get icon() { return null; }
  softkeys() { return []; }
  onKey() { return false; }
  tick() {}
  drawBody() {}
  draw(g) {
    g.fill(0, 0, W, H, C.bg);
    drawHeader(g, this.app, this.title, this.icon);
    this.drawBody(g);
    drawSoftkeys(g, this.softkeys());
  }
}

/** Модальное окно: kind = confirm | warn | error | info. ИТОГ = да/закрыть, C = нет/закрыть. */
export class Dialog extends Screen {
  constructor(app, { kind = 'info', title, text, yes = 'ИТОГ — да', no = 'C — нет', onYes, onNo }) {
    super(app);
    this.modal = true;
    Object.assign(this, { kind, dlgTitle: title, text, yes, no, onYes, onNo });
  }

  onKey(id) {
    if (id === 'ok') { this.app.pop(); this.onYes?.(); return true; }
    if (id === 'clr') { this.app.pop(); (this.kind === 'confirm' ? this.onNo : this.onYes)?.(); return true; }
    return true; // остальные клавиши блокируются
  }

  draw(g) {
    g.fill(0, 0, W, H, 'rgba(0,0,0,0.55)');
    const w = 380, h = 150, x = (W - w) / 2, y = (H - h) / 2;
    const color = { confirm: C.info, warn: C.accent, error: C.danger, info: C.ok }[this.kind];
    const icon = { confirm: 'info', warn: 'triangle-alert', error: 'ban', info: 'circle-check' }[this.kind];
    g.rrect(x, y, w, h, 10, C.panel, color);
    g.icon(icon, x + 16, y + 16, 28, color);
    g.text(this.dlgTitle, x + 56, y + 30, { size: 16, weight: 700, maxW: w - 70 });
    const lines = wrap(g, this.text ?? '', w - 40, 13);
    lines.slice(0, 3).forEach((l, i) => g.text(l, x + 20, y + 64 + i * 18, { size: 13, color: C.text }));
    const hint = this.kind === 'confirm' ? `${this.yes}   ·   ${this.no}` : 'ИТОГ / C — закрыть';
    g.text(hint, x + w / 2, y + h - 18, { size: 12, weight: 600, color: C.muted, align: 'center' });
  }
}

export function wrap(g, text, maxW, size) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (g.measure(t, size) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/**
 * Ввод числа: kind = money | qty | int | pct. onOk(str) -> строка-ошибка или null.
 * onSoft(i, str) — обработка М-клавиш (например, скидка: М1 %, М2 ₽).
 */
export class NumberPrompt extends Screen {
  constructor(app, { title, icon = 'calculator', label, value = '', kind = 'money', onOk, onSoft, soft = [], extra, maxLen = 10, onMinus }) {
    super(app);
    Object.assign(this, { pTitle: title, pIcon: icon, label, value, kind, onOk, onSoft, soft, extra, maxLen, onMinus });
    this.error = '';
  }
  get title() { return this.pTitle; }
  get icon() { return this.pIcon; }
  softkeys() { return typeof this.soft === 'function' ? this.soft() : this.soft; }

  onKey(id) {
    const v = this.value;
    if (/^d\d$/.test(id) || id === 'd00') {
      const add = id === 'd00' ? '00' : id.slice(1);
      if ((v + add).length <= this.maxLen) this.value = v + add;
    } else if (id === 'dot') {
      if (this.kind !== 'int' && !v.includes('.')) this.value = (v || '0') + '.';
    } else if (id === 'bs') this.value = v.slice(0, -1);
    else if (id === 'clr') { if (v) this.value = ''; else this.app.pop(); }
    else if (id === 'ok') { const e = this.onOk?.(this.value); if (e) this.error = e; }
    else if (/^m[1-4]$/.test(id) && this.onSoft) { const e = this.onSoft(Number(id[1]) - 1, this.value); if (e) this.error = e; }
    else if (id === 'minus' && this.onMinus) this.onMinus();
    else return true;
    if (id !== 'ok' && !/^m/.test(id)) this.error = '';
    return true;
  }

  drawBody(g) {
    const x = 60, w = W - 120;
    if (this.extra) this.extra(g, x, BODY_Y + 10, w);
    drawField(g, x, BODY_Y + 80, w, this.label, this.value, { size: 26, placeholder: '0' });
    if (this.error) g.text(this.error, W / 2, BODY_Y + 160, { size: 13, weight: 600, color: C.danger, align: 'center', maxW: W - 40 });
    else g.text('ИТОГ — готово · C — назад · ⌫ — стереть', W / 2, BODY_Y + 160, { size: 11, color: C.dim, align: 'center' });
  }
}

/** Ввод текста T9 с подсказкой-раскладкой как на телефоне. */
export class TextPrompt extends Screen {
  constructor(app, { title, label, value = '', maxLen = 32, onOk }) {
    super(app);
    this.pTitle = title;
    this.label = label;
    this.ed = new T9Editor(value, { maxLen });
    this.onOk = onOk;
    this.error = '';
  }
  get title() { return this.pTitle; }
  get icon() { return 'keyboard'; }
  tick(now) { this.ed.tick(now); }

  onKey(id, now) {
    if (id === 'ok') { const e = this.onOk?.(this.ed.value()); if (e) this.error = e; return true; }
    if (id === 'clr') { this.app.pop(); return true; }
    this.ed.key(id, now);
    this.error = '';
    return true;
  }

  drawBody(g) {
    const d = this.ed.display();
    const x = 12, w = W - 24, y = BODY_Y + 6;
    g.text(this.label, x, y, { size: 11, color: C.muted, baseline: 'top' });
    const lay = LAYOUTS[this.ed.layout];
    g.text(`${lay.name} · ${lay.letters ? CAPS[this.ed.caps] : '—'}`, W - 12, y + 6, { size: 11, weight: 700, color: C.accent, align: 'right' });
    g.rrect(x, y + 18, w, 34, 6, C.panel2, C.accent);
    // текст с курсором (прокрутка, если не помещается)
    const ctx = g.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 8, y + 18, w - 16, 34); ctx.clip();
    const before = d.text.slice(0, d.cursor);
    const fullW = g.measure(before, 18, 600);
    const shift = Math.max(0, fullW - (w - 30));
    const tx = x + 10 - shift;
    g.text(d.text, tx, y + 35, { size: 18, weight: 600 });
    if (d.pendingAt >= 0) {
      const a = g.measure(d.text.slice(0, d.pendingAt), 18, 600);
      const b = g.measure(d.text.slice(0, d.pendingAt + 1), 18, 600);
      g.fill(tx + a, y + 45, b - a, 2, C.accent);
    }
    const cx = tx + g.measure(before, 18, 600);
    if (Math.floor(this.app.hal.millis() / 500) % 2 === 0) g.fill(cx + 1, y + 24, 2, 22, C.text);
    ctx.restore();
    if (this.error) g.text(this.error, W / 2, y + 62, { size: 12, color: C.danger, align: 'center' });

    // сетка как на физическом цифровом блоке: 7 8 9 / 4 5 6 / 1 2 3 / 0 00 .
    const grid = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['0', '00', '.']];
    const gx = 40, gy = y + 70, cw = 118, ch = 30;
    grid.forEach((row, r) => row.forEach((k, c) => {
      const bx = gx + c * (cw + 6), by = gy + r * (ch + 4);
      const active = this.ed.pending && this.ed.pending.key === k;
      g.rrect(bx, by, cw, ch, 6, active ? C.sel : C.panel, C.line);
      g.text(k, bx + 10, by + ch / 2, { size: 13, weight: 800, color: C.accent });
      let hint;
      if (k === '0') hint = `⇧ ${CAPS[this.ed.caps]}`;
      else if (k === '.') hint = `⇄ ${LAYOUTS[(this.ed.layout + 1) % LAYOUTS.length].name}`;
      else hint = (lay.keys[k] ?? '').replace(' ', '␣');
      if (lay.letters && this.ed.caps > 0 && k !== '0' && k !== '.') hint = hint.toUpperCase();
      g.text(hint, bx + 34, by + ch / 2, { size: 13, weight: 600, maxW: cw - 40 });
    }));
    
  }

  softkeys() { return [null, null, null, null]; }
}

