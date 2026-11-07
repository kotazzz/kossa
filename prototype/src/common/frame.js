// Кадр канала RP2040 <-> Guition (см. docs/04-link-protocol.md):
//   COBS( TYPE:u8 | SEQ:u8 | LEN:u16le | PAYLOAD | CRC16:u16le ) , 0x00
import { cobsEncode, cobsDecode } from './cobs.js';
import { crc16 } from './crc16.js';

export const MAX_PAYLOAD = 512;

/**
 * @param {{type:number, seq:number, payload?:Uint8Array}} f
 * @returns {Uint8Array} закодированный кадр вместе с завершающим 0x00
 */
export function encodeFrame({ type, seq, payload = new Uint8Array(0) }) {
  if (payload.length > MAX_PAYLOAD) throw new Error('payload too large');
  const body = new Uint8Array(4 + payload.length + 2);
  body[0] = type;
  body[1] = seq & 0xff;
  body[2] = payload.length & 0xff;
  body[3] = payload.length >> 8;
  body.set(payload, 4);
  const crc = crc16(body.subarray(0, 4 + payload.length));
  body[4 + payload.length] = crc & 0xff;
  body[5 + payload.length] = crc >> 8;
  const enc = cobsEncode(body);
  const out = new Uint8Array(enc.length + 1);
  out.set(enc, 0);
  out[enc.length] = 0;
  return out;
}

/** Побайтный разборщик потока. Ошибки: 'cobs' | 'len' | 'crc' | 'overflow'. */
export class FrameParser {
  /**
   * @param {(f:{type:number,seq:number,payload:Uint8Array})=>void} onFrame
   * @param {(kind:string)=>void} [onError]
   */
  constructor(onFrame, onError = () => {}) {
    this.onFrame = onFrame;
    this.onError = onError;
    this.buf = new Uint8Array(MAX_PAYLOAD + 64);
    this.n = 0;
    this.overflow = false;
  }

  /** @param {number} byte */
  pushByte(byte) {
    if (byte !== 0) {
      if (this.n < this.buf.length) this.buf[this.n++] = byte;
      else this.overflow = true;
      return;
    }
    if (this.n === 0 && !this.overflow) return; // пустой разделитель
    const raw = this.buf.subarray(0, this.n);
    const wasOverflow = this.overflow;
    this.n = 0;
    this.overflow = false;
    if (wasOverflow) return this.onError('overflow');
    const body = cobsDecode(raw);
    if (!body || body.length < 6) return this.onError('cobs');
    const len = body[2] | (body[3] << 8);
    if (len > MAX_PAYLOAD || body.length !== 6 + len) return this.onError('len');
    const crc = body[4 + len] | (body[5 + len] << 8);
    if (crc16(body.subarray(0, 4 + len)) !== crc) return this.onError('crc');
    this.onFrame({ type: body[0], seq: body[1], payload: body.slice(4, 4 + len) });
  }

  /** @param {Uint8Array} bytes */
  push(bytes) {
    for (const b of bytes) this.pushByte(b);
  }
}
