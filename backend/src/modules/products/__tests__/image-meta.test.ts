import { readImageMeta } from '../image-meta';
import { assertSafeKey } from '../../../services/media-storage';
import { jpeg, png, webpExtended, webpLossless, webpLossy } from './image-bytes';

describe('readImageMeta', () => {
  it('reads the size from each format the shop can upload', () => {
    expect(readImageMeta(jpeg(1600, 2000))).toEqual({ kind: 'jpeg', width: 1600, height: 2000 });
    expect(readImageMeta(png(800, 600))).toEqual({ kind: 'png', width: 800, height: 600 });
    expect(readImageMeta(webpLossy(1500, 2000))).toEqual({ kind: 'webp', width: 1500, height: 2000 });
    expect(readImageMeta(webpLossless(640, 480))).toEqual({ kind: 'webp', width: 640, height: 480 });
    expect(readImageMeta(webpExtended(4000, 3000))).toEqual({ kind: 'webp', width: 4000, height: 3000 });
  });

  it('skips the EXIF block a phone puts before the frame', () => {
    const exif = Buffer.alloc(4 + 300);
    exif.writeUInt16BE(0xffe1, 0);
    exif.writeUInt16BE(302, 2);
    const withExif = Buffer.concat([jpeg(1200, 1600).subarray(0, 2), exif, jpeg(1200, 1600).subarray(2)]);
    expect(readImageMeta(withExif)).toEqual({ kind: 'jpeg', width: 1200, height: 1600 });
  });

  it('refuses what is not a picture, whatever it is called', () => {
    expect(readImageMeta(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(readImageMeta(Buffer.from('GIF89a\x01\x00\x01\x00'))).toBeNull();
    expect(readImageMeta(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(readImageMeta(Buffer.alloc(0))).toBeNull();
  });

  it('refuses a header cut short', () => {
    expect(readImageMeta(jpeg(100, 100).subarray(0, 12))).toBeNull();
    expect(readImageMeta(png(100, 100).subarray(0, 18))).toBeNull();
    expect(readImageMeta(webpLossy(100, 100).subarray(0, 22))).toBeNull();
  });
});

describe('media keys', () => {
  it('accepts the keys the server makes', () => {
    expect(() => assertSafeKey('products/12/3f2c8a1e-5b7d-4e1a-9c3b-2d4e6f8a0b1c.webp')).not.toThrow();
  });

  it('refuses anything that could leave the media directory', () => {
    for (const bad of ['../etc/passwd', 'products/../../x.webp', '/abs/x.webp', 'products/1/x', 'products/1/X.webp', '']) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});
