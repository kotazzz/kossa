// Универсальные экраны-меню и формы: список действий, форма полей, многострочный редактор.
import { W, BODY_Y, BODY_H, C } from '../ui/gfx.js';
import { ListView } from '../ui/widgets.js';
import { Screen, Dialog, NumberPrompt, TextPrompt } from '../ui/screen.js';

/** Список пунктов: {label, value?:()=>string, icon?, action?(), left?(), right?()} */
export class MenuList extends Screen {
  constructor(app, { title, icon, items, soft = [] }) {
    super(app);
    this.mTitle = title; this.mIcon = icon; this.items = items; this.soft = soft;
    this.list = new ListView();
  }
  get title() { return this.mTitle; }
  get icon() { return this.mIcon; }
  softkeys() { return this.soft; }
  current() { return this.items[this.list.sel]; }
  onKey(id) {
    const it = this.current();
    switch (id) {
      case 'up': this.list.move(-1, this.items.length); return true;
      case 'down': this.list.move(1, this.items.length); return true;
      case 'left': it?.left?.(); return true;
      case 'right': it?.right?.(); return true;
      case 'ok': (it?.action ?? it?.right)?.(); return true;
      case 'clr': this.app.pop(); return true;
    }
    if (/^d[1-9]$/.test(id)) { const i = Number(id[1]) - 1; if (this.items[i]) { this.list.sel = i; this.items[i].action?.(); } return true; }
    return true;
  }
  drawBody(g) {
    this.list.draw(g, this.items, 8, BODY_Y + 6, W - 22, BODY_H - 12, 30, (g2, it, i, x, y, w, h, sel) => {
      if (it.icon) g2.icon(it.icon, x + 8, y + 7, 16, sel ? C.accent : C.muted);
      g2.text(it.label, x + (it.icon ? 32 : 10), y + h / 2, { size: 14, weight: 600, maxW: w - 200 });
      const v = it.value?.();
      if (v !== undefined) {
        const cyc = it.left || it.right;
        g2.text(cyc && sel ? `‹ ${v} ›` : v, x + w - 10, y + h / 2, { size: 13, weight: 700, color: sel ? C.accent : C.muted, align: 'right', maxW: 200 });
      } else if (it.action) g2.text('›', x + w - 10, y + h / 2, { size: 16, color: C.dim, align: 'right' });
    });
  }
}

/**
 * Форма редактирования объекта. fields: {key, label, type:'text'|'money'|'int'|'pct'|'bool'|'choice', options?, optional?}
 * М1 — сохранить (onSave(obj) -> ошибка|null), C — выход (с подтверждением при изменениях).
 */
export class FormScreen extends Screen {
  constructor(app, { title, icon, obj, fields, onSave, fmt = {} }) {
    super(app);
    Object.assign(this, { fTitle: title, fIcon: icon, obj: { ...obj }, orig: JSON.stringify(obj), fields, onSave, fmt });
    this.list = new ListView();
    this.error = '';
  }
  get title() { return this.fTitle; }
  get icon() { return this.fIcon; }
  softkeys() { return ['Сохранить', null, null, 'Отмена']; }
  dirty() { return JSON.stringify(this.obj) !== this.orig; }

  show(f) {
    const v = this.obj[f.key];
    if (this.fmt[f.key]) return this.fmt[f.key](v);
    if (f.type === 'bool') return v ? 'Да' : 'Нет';
    if (f.type === 'choice') return f.options.find((o) => o.value === v)?.label ?? '—';
    if (v === '' || v === undefined || v === null) return f.optional ? '— не задан —' : '—';
    return String(v);
  }

  cycle(f, d) {
    if (f.type === 'bool') this.obj[f.key] = !this.obj[f.key];
    if (f.type === 'choice') {
      const i = f.options.findIndex((o) => o.value === this.obj[f.key]);
      this.obj[f.key] = f.options[(i + d + f.options.length) % f.options.length].value;
    }
  }

  edit(f) {
    if (f.type === 'bool' || f.type === 'choice') { this.cycle(f, 1); return; }
    if (f.type === 'text') {
      this.app.push(new TextPrompt(this.app, {
        title: this.fTitle, label: f.label, value: this.obj[f.key] ?? '', maxLen: f.maxLen ?? 32,
        onOk: (t) => { if (!t.trim() && !f.optional) return 'Пустое значение'; this.obj[f.key] = t.trim(); this.app.pop(); return null; },
      }));
      return;
    }
    const raw = f.toInput ? f.toInput(this.obj[f.key]) : String(this.obj[f.key] ?? '');
    this.app.push(new NumberPrompt(this.app, {
      title: this.fTitle, icon: this.fIcon, label: f.label, value: raw, kind: f.type === 'int' ? 'int' : 'money', maxLen: f.maxLen ?? 10,
      onOk: (s) => {
        if (!s && f.optional) { this.obj[f.key] = ''; this.app.pop(); return null; }
        const v = f.fromInput ? f.fromInput(s) : s;
        if (v === null || Number.isNaN(v)) return 'Неверное значение';
        this.obj[f.key] = v;
        this.app.pop();
        return null;
      },
    }));
  }

  onKey(id) {
    const f = this.fields[this.list.sel];
    switch (id) {
      case 'up': this.list.move(-1, this.fields.length); break;
      case 'down': this.list.move(1, this.fields.length); break;
      case 'left': if (f) this.cycle(f, -1); break;
      case 'right': if (f) this.cycle(f, 1); break;
      case 'ok': if (f) this.edit(f); break;
      case 'm1': { const e = this.onSave(this.obj); if (e) this.error = e; else { this.app.pop(); this.app.toast('Сохранено', 'ok'); } break; }
      case 'clr': case 'm4':
        if (this.dirty()) this.app.push(new Dialog(this.app, { kind: 'confirm', title: 'Выйти без сохранения?', text: 'Изменения будут потеряны.', onYes: () => this.app.pop() }));
        else this.app.pop();
        break;
    }
    if (id !== 'm1') this.error = '';
    return true;
  }

  drawBody(g) {
    this.list.draw(g, this.fields, 8, BODY_Y + 6, W - 22, BODY_H - (this.error ? 34 : 12), 30, (g2, f, i, x, y, w, h, sel) => {
      g2.text(f.label, x + 10, y + h / 2, { size: 13, color: C.muted });
      const cyc = f.type === 'bool' || f.type === 'choice';
      const v = this.show(f);
      g2.text(cyc && sel ? `‹ ${v} ›` : v, x + w - 10, y + h / 2, { size: 14, weight: 700, color: sel ? C.accent : C.text, align: 'right', maxW: w - 170 });
    });
    if (this.error) g.text(this.error, W / 2, BODY_Y + BODY_H - 14, { size: 13, weight: 700, color: C.danger, align: 'center' });
  }
}

/** Многострочный текст: строки списком; + добавить, − удалить, ИТОГ — править. */
export class LinesEditor extends Screen {
  constructor(app, { title, lines, onChange, maxLines = 6 }) {
    super(app);
    Object.assign(this, { lTitle: title, lines: [...lines], onChange, maxLines });
    this.list = new ListView();
  }
  get title() { return this.lTitle; }
  get icon() { return 'scroll-text'; }
  softkeys() { return ['Готово', null, null, null]; }
  commit() { this.onChange([...this.lines]); }
  onKey(id) {
    const i = this.list.sel;
    switch (id) {
      case 'up': this.list.move(-1, this.lines.length); break;
      case 'down': this.list.move(1, this.lines.length); break;
      case 'plus':
        if (this.lines.length >= this.maxLines) { this.app.toast(`Не больше ${this.maxLines} строк`, 'error'); break; }
        this.app.push(new TextPrompt(this.app, { title: this.lTitle, label: 'Новая строка (до 32 символов)', onOk: (t) => { this.lines.splice(i + 1, 0, t); this.list.sel = i + 1; this.commit(); this.app.pop(); return null; } }));
        break;
      case 'minus':
        if (!this.lines.length) break;
        this.app.push(new Dialog(this.app, { kind: 'confirm', title: 'Удалить строку?', text: this.lines[i], onYes: () => { this.lines.splice(i, 1); this.commit(); } }));
        break;
      case 'ok':
        if (!this.lines.length) break;
        this.app.push(new TextPrompt(this.app, { title: this.lTitle, label: `Строка ${i + 1}`, value: this.lines[i], onOk: (t) => { this.lines[i] = t; this.commit(); this.app.pop(); return null; } }));
        break;
      case 'm1': case 'clr': this.app.pop(); break;
    }
    return true;
  }
  drawBody(g) {
    if (!this.lines.length) g.text('Пусто. «+» — добавить строку', W / 2, BODY_Y + 100, { size: 14, color: C.muted, align: 'center' });
    this.list.draw(g, this.lines, 8, BODY_Y + 6, W - 22, BODY_H - 30, 28, (g2, l, i, x, y, w, h) => {
      g2.text(String(i + 1), x + 10, y + h / 2, { size: 11, weight: 800, color: C.dim });
      g2.text(l || '(пустая строка)', x + 32, y + h / 2, { size: 14, color: l ? C.text : C.dim, maxW: w - 40 });
    });
    g.text('+ добавить · − удалить · ИТОГ править', W / 2, BODY_Y + BODY_H - 12, { size: 11, color: C.dim, align: 'center' });
  }
}
