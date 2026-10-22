// Writes a PNG from raw RGBA buffer with a correct CRC32 table.
const zlib = require('node:zlib');
const crcTable = (() => {
  const T = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    T[n] = c >>> 0;
  }
  return T;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(4 + 4 + 4 + body.length);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  body.copy(head, 8);
  head.writeUInt32BE(crc32(head.subarray(4, 4 + body.length)), 8 + body.length);
  return head;
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  raw[0] = 0;
  for (let y = 0; y < height; y++) {
    raw[1 + y * (1 + stride)] = 0;
    rgba.copy(raw, 2 + y * (1 + stride), y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { encodePng };
