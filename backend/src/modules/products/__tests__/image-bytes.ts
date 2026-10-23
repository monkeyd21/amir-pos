/**
 * Smallest files that carry a real JPEG, PNG or WebP header, built byte by
 * byte. The server only reads headers, so the pixel data can be left out.
 */

export function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc2, 0); // progressive frame, as phone cameras write
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

export function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function riff(chunk: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(12 + payload.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(chunk, 12, 'latin1');
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload]);
}

/** Lossy WebP, what a browser canvas produces. */
export function webpLossy(width: number, height: number): Buffer {
  const p = Buffer.alloc(12);
  p[3] = 0x9d;
  p[4] = 0x01;
  p[5] = 0x2a;
  p.writeUInt16LE(width, 6);
  p.writeUInt16LE(height, 8);
  return riff('VP8 ', p);
}

export function webpLossless(width: number, height: number): Buffer {
  const p = Buffer.alloc(12);
  p[0] = 0x2f;
  p.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  return riff('VP8L', p);
}

export function webpExtended(width: number, height: number): Buffer {
  const p = Buffer.alloc(12);
  p.writeUIntLE(width - 1, 4, 3);
  p.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', p);
}
