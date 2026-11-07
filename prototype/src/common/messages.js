// Типы сообщений и сериализация payload (см. docs/04-link-protocol.md).

export const MSG = Object.freeze({
  // RP2040 -> Guition
  HELLO: 0x01,
  KEY: 0x02,
  PRINTER_STATUS: 0x03,
  ACK: 0x04,
  NAK: 0x05,
  // Guition -> RP2040
  PING: 0x10,
  PRINT_RAW: 0x11,
  PRINT_BEGIN: 0x12,
  PRINT_ROWS: 0x13,
  PRINT_END: 0x14,
  PRINTER_CFG: 0x15,
  KEY_CFG: 0x16,
});

export const NAME = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [v, k]));

/** Флаги PRINTER_STATUS */
export const PS = Object.freeze({ BUSY: 1, PENDING: 2, ERROR: 4 });
/** Коды NAK */
export const NAK = Object.freeze({ OVERFLOW: 1, UNKNOWN: 2, BAD_ARGS: 3 });

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export const build = {
  hello: (fw = 1, caps = 0) => Uint8Array.from([...u16(fw), ...u16(caps)]),
  key: (code, down) => Uint8Array.from([code, down ? 1 : 0]),
  printerStatus: (flags, credit) => Uint8Array.from([flags, ...u16(credit)]),
  ack: (seq, credit) => Uint8Array.from([seq, ...u16(credit)]),
  nak: (seq, code) => Uint8Array.from([seq, code]),
  printBegin: (widthBytes, rows) => Uint8Array.from([widthBytes, ...u16(rows)]),
  printEnd: (feedLines) => Uint8Array.from([feedLines]),
  printerCfg: (baud, n1 = 7, n2 = 120, n3 = 40) => Uint8Array.from([...u32(baud), n1, n2, n3]),
  keyCfg: (debounceMs) => Uint8Array.from([debounceMs]),
};

export const parse = {
  hello: (p) => ({ fw: p[0] | (p[1] << 8), caps: p[2] | (p[3] << 8) }),
  key: (p) => ({ code: p[0], down: p[1] === 1 }),
  printerStatus: (p) => ({ flags: p[0], credit: p[1] | (p[2] << 8) }),
  ack: (p) => ({ seq: p[0], credit: p[1] | (p[2] << 8) }),
  nak: (p) => ({ seq: p[0], code: p[1] }),
  printBegin: (p) => ({ widthBytes: p[0], rows: p[1] | (p[2] << 8) }),
  printEnd: (p) => ({ feedLines: p[0] }),
  printerCfg: (p) => ({
    baud: (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0,
    n1: p[4], n2: p[5], n3: p[6],
  }),
  keyCfg: (p) => ({ debounceMs: p[0] }),
};

/** Текстовое описание для лога панели */
export function describe(frame) {
  const name = NAME[frame.type] ?? '0x' + frame.type.toString(16);
  const p = frame.payload;
  let d = '';
  switch (frame.type) {
    case MSG.KEY: { const k = parse.key(p); d = `code=${k.code} ${k.down ? 'down' : 'up'}`; break; }
    case MSG.ACK: { const a = parse.ack(p); d = `seq=${a.seq} credit=${a.credit}`; break; }
    case MSG.NAK: { const a = parse.nak(p); d = `seq=${a.seq} code=${a.code}`; break; }
    case MSG.PRINTER_STATUS: { const s = parse.printerStatus(p); d = `flags=${s.flags} credit=${s.credit}`; break; }
    case MSG.PRINT_BEGIN: { const b = parse.printBegin(p); d = `${b.widthBytes}B x ${b.rows} rows`; break; }
    case MSG.PRINT_END: d = `feed=${parse.printEnd(p).feedLines}`; break;
    case MSG.PRINTER_CFG: d = `baud=${parse.printerCfg(p).baud}`; break;
    case MSG.HELLO: d = `fw=${parse.hello(p).fw}`; break;
    default: if (p.length) d = `${p.length} bytes`;
  }
  return `${name}#${frame.seq} ${d}`.trim();
}
