import { deflateSync } from 'node:zlib';

/**
 * Minimal, dependency-free PNG encoder — a solid-colour 8-bit RGB image.
 *
 * Only exists to build test fixtures with a raster image of a *specific pixel
 * size*. That distinction matters: the scanned-PDF detector reads an embedded
 * image's own declared width/height, not how large it is drawn on the page, so
 * a fixture must carry the real pixel dimensions under test.
 */
export function solidPng(width: number, height: number, rgb: [number, number, number] = [200, 200, 200]): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)

  const stride = width * 3 + 1; // +1 for the per-scanline filter-type byte
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }

  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
