// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, без отражения. check("123456789") = 0x29B1

/** @param {Uint8Array} data @returns {number} */
export function crc16(data) {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
