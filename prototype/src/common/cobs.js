// COBS (Consistent Overhead Byte Stuffing): убирает нули из данных,
// чтобы 0x00 можно было использовать как разделитель кадров.
// Портируется на C/C++ почти построчно.

/** @param {Uint8Array} data @returns {Uint8Array} */
export function cobsEncode(data) {
  const out = [0];
  let codeIdx = 0;
  let code = 1;
  for (const b of data) {
    if (b === 0) {
      out[codeIdx] = code;
      codeIdx = out.length;
      out.push(0);
      code = 1;
    } else {
      out.push(b);
      code++;
      if (code === 0xff) {
        out[codeIdx] = code;
        codeIdx = out.length;
        out.push(0);
        code = 1;
      }
    }
  }
  out[codeIdx] = code;
  return Uint8Array.from(out);
}

/** @param {Uint8Array} data @returns {Uint8Array|null} null при ошибке */
export function cobsDecode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const code = data[i++];
    if (code === 0) return null;
    for (let j = 1; j < code; j++) {
      if (i >= data.length) return null;
      out.push(data[i++]);
    }
    if (code !== 0xff && i < data.length) out.push(0);
  }
  return Uint8Array.from(out);
}
