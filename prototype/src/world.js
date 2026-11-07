// Сборка «мира»: все устройства и провода между ними. Используется и в браузере, и в Node-тестах.
// Менять для перехода на железо нужно ТОЛЬКО эту сборку (HAL-реализации), а не прошивки.
//
//   [keypad matrix]--GPIO--[RP2040 firmware]--UART0--[Guition app]
//                                  |
//                               UART1 + DTR
//                                  |
//                          [thermal printer]
import { GpioBank } from './sim/gpio.js';
import { KeypadMatrix } from './sim/keypad.js';
import { UartPort, UartWire } from './sim/uart.js';
import { ThermalPrinter } from './sim/printer.js';
import { PeripheralController } from './rp2040/firmware.js';
import { CashApp } from './guition/app.js';
import { FrameParser } from './common/frame.js';
import { LINK_BAUD, PRINTER_BAUD_DEFAULT } from './common/pins.js';

/**
 * @param {object} o
 * @param {(w:number,h:number)=>object} o.createSurface  поверхность рисования (подмножество Canvas2D)
 * @param {(surface:object)=>void} [o.present]            вывод кадра на «панель»
 * @param {{list:()=>string[], loadImage:(n:string)=>Promise<object>}} o.sd
 * @param {{load:(k:string)=>any, save:(k:string,v:any)=>void}} o.storage  энергонезависимая память
 * @param {object} [o.assets] загрузчики шрифтов/иконок (см. app.js)
 * @param {Function} [o.renderLine]  встроенный шрифт принтера
 * @param {number} [o.printerBaud] реальная скорость принтера (физическая настройка)
 * @param {number} [o.appPrinterBaud] какую скорость приложение просит у RP2040
 * @param {number} [o.volts] питание принтера
 */
export function createWorld({
  createSurface, present = () => {}, setBrightness, sd, renderLine, storage, assets, epoch, beep,
  printerBaud = PRINTER_BAUD_DEFAULT, appPrinterBaud = PRINTER_BAUD_DEFAULT, volts = 9,
}) {
  const gpio = new GpioBank();
  const keypad = new KeypadMatrix();
  const printer = new ThermalPrinter({ baud: printerBaud, volts, renderLine });
  gpio.attach(keypad);
  gpio.attach(printer);

  const rpHost = new UartPort({ name: 'rp.uart0', baud: LINK_BAUD, txCap: 64, rxCap: 1024 });
  const rpPrn = new UartPort({ name: 'rp.uart1', baud: PRINTER_BAUD_DEFAULT, txCap: 32, rxCap: 256 });
  const guLink = new UartPort({ name: 'gu.uart1', baud: LINK_BAUD, txCap: 256, rxCap: 1024 });
  const linkWire = new UartWire(rpHost, guLink); // a2b: RP2040 -> Guition
  const prnWire = new UartWire(rpPrn, printer.uart);

  const clock = { ms: 0 };
  const rp = new PeripheralController({ gpio, host: rpHost, prn: rpPrn, millis: () => clock.ms });
  const app = new CashApp({
    link: guLink,
    display: { width: 480, height: 272, present, setBrightness },
    createSurface,
    sd,
    storage,
    assets,
    beep,
    printerBaud: appPrinterBaud,
    millis: () => clock.ms,
    epoch: epoch ?? (() => Date.now()),
  });

  // отладочный разбор кадров на проводе
  const frameListeners = [];
  const mkTap = (dir) => {
    const p = new FrameParser((f) => frameListeners.forEach((l) => l(dir, f, clock.ms)));
    return (d, b) => { if (d === (dir === 'rp2gu' ? 'a2b' : 'b2a')) p.pushByte(b); };
  };
  linkWire.taps.push(mkTap('rp2gu'), mkTap('gu2rp'));

  rp.setup();
  const ready = app.setup();

  return {
    gpio, keypad, printer, rp, app, rpHost, rpPrn, guLink, linkWire, prnWire, clock, ready,
    onLinkFrame: (cb) => frameListeners.push(cb),
    pressKey: (code) => keypad.press(code),
    releaseKey: (code) => keypad.release(code),
    /** Продвинуть виртуальное время на dtMs миллисекунд (шаг 1 мс). */
    step(dtMs) {
      for (let i = 0; i < dtMs; i++) {
        clock.ms++;
        linkWire.tick(1);
        prnWire.tick(1);
        printer.tick(1);
        rp.loop();
        app.loop();
      }
    },
  };
}
