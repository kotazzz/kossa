// Симуляция UART: порты с конечными буферами и проводом со скоростью baud.
// Интерфейс «железа» (HAL), которым пользуются прошивки: write / txFree / available / read / setBaud.
// На реальных платах реализуется через Serial (ESP32) / Serial1 (RP2040).

class Ring {
  constructor(cap) { this.cap = cap; this.buf = new Uint8Array(cap); this.head = 0; this.len = 0; }
  push(b) { if (this.len >= this.cap) return false; this.buf[(this.head + this.len++) % this.cap] = b; return true; }
  shift() { if (!this.len) return -1; const b = this.buf[this.head]; this.head = (this.head + 1) % this.cap; this.len--; return b; }
  peek(i = 0) { return i < this.len ? this.buf[(this.head + i) % this.cap] : -1; }
  clear() { this.head = 0; this.len = 0; }
}

export class UartPort {
  /** @param {{name:string, baud:number, txCap?:number, rxCap?:number}} o */
  constructor({ name, baud, txCap = 1024, rxCap = 1024 }) {
    this.name = name;
    this.baud = baud;
    this.tx = new Ring(txCap);
    this.rx = new Ring(rxCap);
    this.rxOverflow = 0; // потеряно байт: приёмный буфер полон
    this.framingErrors = 0; // принято на «чужой» скорости
    this.txBytes = 0;
    this.rxBytes = 0;
  }

  // ----- HAL -----
  /** Записать байты в передатчик. @returns {number} сколько принято (может быть меньше!) */
  write(bytes) {
    let n = 0;
    for (const b of bytes) { if (!this.tx.push(b)) break; n++; }
    return n;
  }
  txFree() { return this.tx.cap - this.tx.len; }
  available() { return this.rx.len; }
  /** @returns {number} байт или -1 */
  read() { return this.rx.shift(); }
  peek(i = 0) { return this.rx.peek(i); }
  setBaud(baud) { this.baud = baud; }
}

/** Провод между двумя портами (A.tx -> B.rx и B.tx -> A.rx). */
export class UartWire {
  /** @param {UartPort} a @param {UartPort} b */
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.carryAB = 0;
    this.carryBA = 0;
    /** @type {Array<(dir:'a2b'|'b2a', byte:number)=>void>} */
    this.taps = [];
  }

  tick(dtMs) {
    this.carryAB = this._move(this.a, this.b, this.carryAB, dtMs, 'a2b');
    this.carryBA = this._move(this.b, this.a, this.carryBA, dtMs, 'b2a');
  }

  _move(from, to, carry, dtMs, dir) {
    carry += ((from.baud / 10) * dtMs) / 1000; // 8N1: 10 бит на байт
    let n = Math.floor(carry);
    carry -= n;
    while (n > 0 && from.tx.len > 0) {
      let b = from.tx.shift();
      from.txBytes++;
      if (to.baud !== from.baud) { b = 0xff; to.framingErrors++; }
      if (!to.rx.push(b)) to.rxOverflow++;
      else to.rxBytes++;
      for (const t of this.taps) t(dir, b);
      n--;
    }
    if (from.tx.len === 0 && carry > 1) carry = 1; // пока линия простаивает, время не копится
    return carry;
  }
}
