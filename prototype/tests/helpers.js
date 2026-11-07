import { createWorld } from '../src/world.js';
import { memoryStorage } from '../src/guition/db/store.js';
import { codeOf } from '../src/guition/keymap.js';

/** Поверхность-пустышка для Node: рисование игнорируется, getRGBA отдаёт белое. */
export function fakeSurface(w, h) {
  const noop = () => {};
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), set: () => true });
  return { width: w, height: h, ctx, getRGBA: () => new Uint8ClampedArray(w * h * 4).fill(255), drawImageRGBA: noop };
}

export function makeWorld(opts = {}) {
  return createWorld({
    createSurface: fakeSurface,
    sd: { list: () => [], loadImage: async () => { throw new Error('no sd'); } },
    storage: memoryStorage(),
    epoch: () => Date.UTC(2026, 9, 26, 9, 30),
    ...opts,
  });
}

/** Крутить мир, пока условие не выполнится или не истечёт лимит. @returns {number} затраченные мс */
export function runUntil(world, cond, limitMs = 20000) {
  let t = 0;
  while (!cond() && t < limitMs) { world.step(1); t++; }
  return t;
}

/** Дождаться окончания загрузки (главное меню). */
export async function booted(world, limitMs = 5000) {
  for (let t = 0; t < limitMs && !world.app.boot.done; t++) { world.step(1); await Promise.resolve(); }
  return world.app.boot.done;
}

/** Нажать клавишу по id с удержанием дольше дебаунса. */
export async function press(world, id, holdMs = 15) {
  const c = codeOf(id);
  world.pressKey(c); world.step(holdMs); world.releaseKey(c); world.step(15);
  await Promise.resolve();
}

/** Набрать последовательность клавиш: '1','2','.', или id вида 'ok','code'. */
export async function type(world, ...keys) {
  for (const k of keys) {
    if (/^[0-9]$/.test(k)) await press(world, 'd' + k);
    else if (k === '.') await press(world, 'dot');
    else if (k === '00') await press(world, 'd00');
    else await press(world, k);
  }
}

/** Дождаться, пока вся печать закончится. */
export function printIdle(world, limitMs = 60000) {
  return runUntil(world, () => !world.app.job && world.app.jobQueue.length === 0 && world.printer.outRows.length === 0 && world.printer.uart.available() === 0 && world.rp.pqLen === 0, limitMs);
}
