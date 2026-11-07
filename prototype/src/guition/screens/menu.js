// Загрузка (реальный прогресс по задачам) и главное меню режимов.
import { W, H, BODY_Y, C } from '../ui/gfx.js';
import { drawProgress } from '../ui/widgets.js';
import { Screen } from '../ui/screen.js';

export class BootScreen extends Screen {
  get title() { return ''; }
  onKey() { return true; }
  draw(g) {
    const b = this.app.boot;
    g.fill(0, 0, W, H, C.bg);
    // логотип
    g.rrect(W / 2 - 34, 46, 68, 68, 16, C.accent);
    g.icon('receipt', W / 2 - 22, 58, 44, '#1a1405');
    g.text('КОССА', W / 2, 140, { size: 30, weight: 800, align: 'center' });
    g.text('нефискальная касса', W / 2, 166, { size: 12, color: C.muted, align: 'center' });
    drawProgress(g, 90, 196, W - 180, 10, b.progress);
    const step = b.current ? `${b.current}…` : b.done ? 'Готово' : '';
    g.text(step, W / 2, 222, { size: 12, color: C.muted, align: 'center' });
    if (b.errors.length) g.text(b.errors[b.errors.length - 1], W / 2, 244, { size: 11, color: C.danger, align: 'center', maxW: W - 20 });
  }
}

export const MODES = [
  { id: 'sale', name: 'Касса', icon: 'shopping-cart', hint: 'продажи, возвраты' },
  { id: 'reports', name: 'Отчёты', icon: 'chart-column', hint: 'X, Z, смена' },
  { id: 'money', name: 'Деньги', icon: 'hand-coins', hint: 'внесение, выплата' },
  { id: 'db', name: 'База', icon: 'database', hint: 'товары, налоги' },
  { id: 'settings', name: 'Настройки', icon: 'settings', hint: 'печать, прочее' },
];

export class MainMenu extends Screen {
  constructor(app) { super(app); this.sel = 0; }
  get title() { return this.app.db.shop.name; }
  get icon() { return 'store'; }
  softkeys() { return [null, null, null, null]; }

  onKey(id) {
    const n = MODES.length;
    if (id === 'left') this.sel = (this.sel + n - 1) % n;
    else if (id === 'right') this.sel = (this.sel + 1) % n;
    else if (id === 'up' || id === 'down') this.sel = this.sel < 3 ? Math.min(n - 1, this.sel + 3) : this.sel - 3;
    else if (id === 'ok') this.app.openMode(MODES[this.sel].id);
    else if (/^d[1-5]$/.test(id)) this.app.openMode(MODES[Number(id[1]) - 1].id);
    return true;
  }

  drawBody(g) {
    const cols = 3, tw = 148, th = 86, gap = 8;
    const x0 = (W - cols * tw - (cols - 1) * gap) / 2, y0 = BODY_Y + 10;
    MODES.forEach((m, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const rowCount = r === 0 ? cols : MODES.length - cols;
      const rx = r === 0 ? x0 : (W - rowCount * tw - (rowCount - 1) * gap) / 2;
      const x = rx + c * (tw + gap), y = y0 + r * (th + gap);
      const sel = i === this.sel;
      g.rrect(x, y, tw, th, 10, sel ? C.sel : C.panel, sel ? C.accent : C.line);
      g.icon(m.icon, x + tw / 2 - 15, y + 10, 30, sel ? C.accent : C.text);
      g.text(m.name, x + tw / 2, y + 56, { size: 15, weight: 700, align: 'center' });
      g.text(m.hint, x + tw / 2, y + 72, { size: 10, color: C.muted, align: 'center' });
      g.text(String(i + 1), x + 10, y + 12, { size: 10, weight: 800, color: C.dim });
    });
    const j = this.app.journal;
    g.text(`${this.app.db.cashier} · смена ${j.shift.no} ${j.shift.open ? 'открыта' : 'закрыта'} · следующий документ № ${String(j.nextNo).padStart(4, '0')}`,
      W / 2, H - 37, { size: 11, color: C.dim, align: 'center' });
  }
}
