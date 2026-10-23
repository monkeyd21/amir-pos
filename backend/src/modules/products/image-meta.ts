/**
 * What an uploaded picture really is, read from its bytes.
 *
 * The browser's claimed MIME type and file name are only a hint, so the server
 * decides from the file itself: a JPEG, PNG or WebP header, and the pixel size
 * written in it. Anything else is refused. Pure, so it is tested without disk.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp';

export interface ImageMeta {
  kind: ImageKind;
  width: number;
  height: number;
}

export const IMAGE_CONTENT_TYPES: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const IMAGE_EXTENSIONS: Record<ImageKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

function ascii(buf: Buffer, start: number, len: number): string {
  return buf.toString('latin1', start, start + len);
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4), then width and height.
  if (buf.length < 24 || ascii(buf, 12, 4) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = ascii(buf, 12, 4);
  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte frame tag, the start code 9d 01 2a, then 14-bit sizes.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2f, then width-1 and height-1 packed in 14 bits each.
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: canvas width-1 and height-1 as 24-bit little-endian.
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // Fill bytes between markers.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    // Standalone markers have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** The picture's format and pixel size, or null when it is not a JPEG, PNG or WebP we can read. */
export function readImageMeta(buf: Buffer): ImageMeta | null {
  let kind: ImageKind | null = null;
  let size: { width: number; height: number } | null = null;

  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    kind = 'jpeg';
    size = jpegSize(buf);
  } else if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    kind = 'png';
    size = pngSize(buf);
  } else if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    kind = 'webp';
    size = webpSize(buf);
  }

  if (!kind || !size || size.width < 1 || size.height < 1) return null;
  return { kind, width: size.width, height: size.height };
}
