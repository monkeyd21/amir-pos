import { fitWithin, preparePhoto } from './photo-prepare';

function canvasBlob(width: number, height: number, type = 'image/png'): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, 0, width, height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), type));
}

describe('fitWithin', () => {
  it('caps the longest side and keeps the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('preparePhoto', () => {
  it('shrinks a large photo and writes WebP', async () => {
    const out = await preparePhoto(await canvasBlob(3000, 2400), 1000);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(800);
    expect(out.blob.type).toBe('image/webp');
  });

  it('explains a file it cannot read', async () => {
    await expectAsync(preparePhoto(new Blob(['not a picture'], { type: 'image/jpeg' }))).toBeRejectedWithError(
      /could not be read/
    );
  });

  it('says what to do with an iPhone HEIC photo', async () => {
    const heic = new File(['not decodable here'], 'IMG_0412.HEIC', { type: '' });
    await expectAsync(preparePhoto(heic)).toBeRejectedWithError(/HEIC photos cannot be read/);
  });
});
