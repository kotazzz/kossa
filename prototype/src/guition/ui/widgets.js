// Общие элементы интерфейса: шапка, софт-клавиши М1–М4, список с выделением, полоса прогресса.
import { W, H, HEADER_H, FOOTER_H, C } from './gfx.js';

const pad2 = (n) => String(n).padStart(2, '0');

export function drawHeader(g, app, title, icon) {
  g.fill(0, 0, W, HEADER_H, C.panel);
  g.hline(0, HEADER_H - 1, W, C.line);
  let x = 8;
  if (icon) { g.icon(icon, x, 4, 16, C.accent); x += 22; }
  g.text(title, x, 12, { size: 13, weight: 700, maxW: 230 });
  // справа: время, принтер, связь, смена
  let rx = W - 8;
  const d = new Date(app.epoch());
  const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  rx -= g.text(t, rx, 12, { size: 12, weight: 600, color: C.muted, align: 'right' }) + 10;
  const prn = app.printerState();
  g.icon('printer', rx - 16, 4, 16, prn === 'ready' ? C.ok : prn === 'busy' ? C.accent : C.danger);
  rx -= 24;
  g.icon(app.rpReady ? 'cable' : 'wifi-off', rx - 16, 4, 16, app.rpReady ? C.ok : C.danger);
  rx -= 24;
  if (app.journal) {
    const sh = app.journal.shift;
    g.text(`См. ${sh.no}${sh.open ? '' : ' (закр.)'}`, rx, 12, { size: 11, color: sh.open ? C.muted : C.dim, align: 'right' });
  }
}

/** labels: массив из 4 подписей (или null) */
export function drawSoftkeys(g, labels = []) {
  const y = H - FOOTER_H;
  g.fill(0, y, W, FOOTER_H, C.panel);
  g.hline(0, y, W, C.line);
  const w = W / 4;
  for (let i = 0; i < 4; i++) {
    const l = labels[i];
    const x = i * w;
    if (i) g.fill(x, y + 4, 1, FOOTER_H - 8, C.line);
    if (!l) continue;
    g.rrect(x + 6, y + 5, 22, 14, 3, C.accent);
    g.text(`M${i + 1}`, x + 17, y + 12, { size: 9, weight: 800, color: '#1a1405', align: 'center' });
    g.text(l, x + 34, y + 12, { size: 11, weight: 600, maxW: w - 40 });
  }
}

export class ListView {
  constructor() { this.sel = 0; this.top = 0; }

  move(delta, count) {
    if (!count) { this.sel = 0; return; }
    this.sel = Math.max(0, Math.min(count - 1, this.sel + delta));
  }

  clamp(count) { this.sel = Math.max(0, Math.min(this.sel, count - 1)); }

  /**
   * @param {(g, item, i, x, y, w, h, selected)=>void} row
   */
  draw(g, items, x, y, w, h, rowH, row, { showSel = true } = {}) {
    const vis = Math.floor(h / rowH);
    this.clamp(items.length);
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + vis) this.top = this.sel - vis + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, items.length - vis)));
    for (let i = this.top; i < Math.min(items.length, this.top + vis); i++) {
      const ry = y + (i - this.top) * rowH;
      const selected = showSel && i === this.sel;
      if (selected) g.rrect(x, ry + 1, w, rowH - 2, 5, C.sel);
      row(g, items[i], i, x, ry, w, rowH, selected);
    }
    if (items.length > vis) { // полоса прокрутки
      const th = Math.max(16, (h * vis) / items.length);
      const ty = y + ((h - th) * this.top) / Math.max(1, items.length - vis);
      g.rrect(x + w + 2, ty, 3, th, 1.5, C.line);
    }
  }
}

export function drawProgress(g, x, y, w, h, frac, color = C.accent) {
  g.rrect(x, y, w, h, h / 2, C.panel2, C.line);
  if (frac > 0) g.rrect(x, y, Math.max(h, w * Math.min(1, frac)), h, h / 2, color);
}

/** Поле ввода с меткой. */
export function drawField(g, x, y, w, label, value, { active = true, size = 22, placeholder = '' } = {}) {
  g.text(label, x, y, { size: 11, color: C.muted, baseline: 'top' });
  g.rrect(x, y + 16, w, size + 14, 6, C.panel2, active ? C.accent : C.line);
  const v = value || placeholder;
  g.text(v, x + w - 10, y + 16 + (size + 14) / 2, { size, weight: 700, color: value ? C.text : C.dim, align: 'right', maxW: w - 20 });
}
