// A minimal PNG reader for 8-bit images (colour types 0, 2, 4 and 6),
// non-interlaced. Enough to sample the pixels of a screenshot.
const zlib = require('node:zlib');

function readPngSync(buffer) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels) throw new Error(`unsupported png ${bitDepth}/${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  // Always hand back RGBA, whatever the source colour type was.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 4) { out.copy(rgba, i * 4, i * 4, i * 4 + 4); }
    else if (channels === 3) { rgba[i*4] = out[i*3]; rgba[i*4+1] = out[i*3+1]; rgba[i*4+2] = out[i*3+2]; rgba[i*4+3] = 255; }
    else if (channels === 1) { rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = out[i]; rgba[i*4+3] = 255; }
    else { rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = out[i*2]; rgba[i*4+3] = out[i*2+1]; }
  }
  return { width, height, channels: 4, data: rgba };
}

const px = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

module.exports = { readPngSync, px };
