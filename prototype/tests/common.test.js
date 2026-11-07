import test from 'node:test';
import assert from 'node:assert/strict';
import { cobsEncode, cobsDecode } from '../src/common/cobs.js';
import { crc16 } from '../src/common/crc16.js';
import { encodeFrame, FrameParser } from '../src/common/frame.js';
import { MSG } from '../src/common/messages.js';

test('crc16 check value', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29b1);
});

test('cobs roundtrip, no zeros in output', () => {
  for (const len of [0, 1, 2, 253, 254, 255, 256, 600]) {
    for (const fill of [0, 1, 0xff]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i % 7 === 0 ? 0 : fill));
      const enc = cobsEncode(data);
      assert.ok(!enc.includes(0));
      assert.deepEqual(cobsDecode(enc), data);
    }
  }
});

test('frame roundtrip, resync after garbage, crc error', () => {
  const got = [], errs = [];
  const p = new FrameParser((f) => got.push(f), (e) => errs.push(e));
  const payload = Uint8Array.from([0, 1, 2, 0, 255]);
  const f1 = encodeFrame({ type: MSG.PRINT_RAW, seq: 7, payload });
  const bad = Uint8Array.from(f1); bad[3] ^= 0x55;
  p.push(Uint8Array.from([5, 6, 7, 0])); // мусор до разделителя
  p.push(bad);
  p.push(f1);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].payload, payload);
  assert.equal(got[0].seq, 7);
  assert.ok(errs.length >= 1);
});

test('max payload frame', () => {
  const got = [];
  const p = new FrameParser((f) => got.push(f));
  const payload = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff);
  p.push(encodeFrame({ type: MSG.PRINT_ROWS, seq: 1, payload }));
  assert.deepEqual(got[0].payload, payload);
});
