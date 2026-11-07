// Тонкая обёртка рисования для экранов 480x272 (на железе — LVGL/Arduino_GFX с теми же примитивами).

export const W = 480;
export const H = 272;
export const HEADER_H = 24;
export const FOOTER_H = 24;
export const BODY_Y = HEADER_H;
export const BODY_H = H - HEADER_H - FOOTER_H;

export const C = {
  bg: '#0f141b', panel: '#17202b', panel2: '#1e2935', line: '#2a3747',
  text: '#eef3f8', muted: '#8b9bb0', dim: '#5b6b80',
  accent: '#ffcc4d', ok: '#4ade80', danger: '#f87171', info: '#60a5fa', sel: '#2b4a78',
};

export const FONT_UI = '"KossaUI", "Montserrat", system-ui, sans-serif';

export class Gfx {
  constructor(ctx, icons) { this.ctx = ctx; this.icons = icons; }

  fill(x, y, w, h, color) { this.ctx.fillStyle = color; this.ctx.fillRect(x, y, w, h); }

  rrect(x, y, w, h, r, color, stroke = null) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    if (color) { c.fillStyle = color; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }

  font(size, weight = 500) { return `${weight} ${size}px ${FONT_UI}`; }

  /** @returns {number} ширина текста */
  text(str, x, y, { size = 14, weight = 500, color = C.text, align = 'left', baseline = 'middle', maxW = 0 } = {}) {
    const c = this.ctx;
    c.font = this.font(size, weight);
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = baseline;
    let s = String(str);
    if (maxW > 0 && c.measureText(s).width > maxW) {
      while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s += '…';
    }
    c.fillText(s, x, y);
    return c.measureText(s).width;
  }

  measure(str, size = 14, weight = 500) { this.ctx.font = this.font(size, weight); return this.ctx.measureText(String(str)).width; }

  icon(name, x, y, size, color = C.text) { this.icons?.draw(this.ctx, name, x, y, size, color); }

  hline(x, y, w, color = C.line) { this.fill(x, y, w, 1, color); }
}
