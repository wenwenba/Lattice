import { deflateSync } from "node:zlib";

// Small deterministic RGBA PNG: red left half, blue right half.
export function testPng(alpha = 255): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(4 * 33);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const i = y * 33 + 1 + x * 4;
    pixels[i] = x < 4 ? 255 : 0; pixels[i + 2] = x >= 4 ? 255 : 0; pixels[i + 3] = alpha;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
