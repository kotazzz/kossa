// Симуляция GPIO RP2040: pinMode / digitalWrite / digitalRead.
// Внешние устройства (клавиатура, DTR принтера) подключаются через attach() и «тянут» входы.

export const OUTPUT = 'out';
export const INPUT = 'in';
export const INPUT_PULLUP = 'in_pullup';

export class GpioBank {
  constructor() {
    /** @type {Map<number,string>} */ this.modes = new Map();
    /** @type {Map<number,number>} */ this.outs = new Map();
    /** @type {Array<{drive:(pin:number, bank:GpioBank)=>(0|1|undefined)}>} */ this.devices = [];
  }

  attach(device) { this.devices.push(device); }

  pinMode(pin, mode) { this.modes.set(pin, mode); }

  digitalWrite(pin, value) { this.outs.set(pin, value ? 1 : 0); }

  digitalRead(pin) {
    const mode = this.modes.get(pin) ?? INPUT;
    if (mode === OUTPUT) return this.outs.get(pin) ?? 0;
    for (const d of this.devices) {
      const v = d.drive(pin, this);
      if (v !== undefined) return v;
    }
    return mode === INPUT_PULLUP ? 1 : 0; // без подтяжки вход «плавает»; считаем 0
  }

  /** Линия сейчас активно прижата к земле выходом? */
  isDrivenLow(pin) {
    return this.modes.get(pin) === OUTPUT && (this.outs.get(pin) ?? 0) === 0;
  }
}
