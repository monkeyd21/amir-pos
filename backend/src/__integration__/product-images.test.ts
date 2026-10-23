/**
 * Product photos against a real database and a real (temporary) media folder.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describeDb, makeFixture, prisma } from './helpers';
import { LocalDiskStorage } from '../services/media-storage';
import { addImage, deleteImage, listImages, reorderImages, updateImage, MAX_IMAGES_PER_PRODUCT } from '../modules/products/images';
import { jpeg, png, webpLossy } from '../modules/products/__tests__/image-bytes';

let dir: string;
let storage: LocalDiskStorage;

const exists = (key: string) =>
  fs.access(path.join(dir, key)).then(
    () => true,
    () => false
  );

describeDb('product photos', () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'));
    storage = new LocalDiskStorage(dir, 'https://shop.example.com/media');
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('stores the file, records its real size, and makes the first one the main photo', async () => {
    const { productId } = await makeFixture(1);
    const first = await addImage(productId, webpLossy(1500, 2000), '  Front  ', storage);
    const second = await addImage(productId, jpeg(1200, 1600), null, storage);

    expect(first).toMatchObject({ width: 1500, height: 2000, alt: 'Front', isPrimary: true, sortOrder: 0 });
    expect(second).toMatchObject({ isPrimary: false, sortOrder: 1, alt: null });
    expect(first.url).toMatch(new RegExp(`^https://shop\\.example\\.com/media/products/${productId}/[0-9a-f-]{36}\\.webp$`));
    expect(second.url.endsWith('.jpg')).toBe(true);

    const row = await prisma.productImage.findUniqueOrThrow({ where: { id: first.id } });
    expect(await exists(row.storageKey!)).toBe(true);
  });

  it('refuses a file that is not a photo, or one too small to sell from, and writes nothing', async () => {
    const { productId } = await makeFixture(1);
    await expect(addImage(productId, Buffer.from('<svg/>'), null, storage)).rejects.toThrow(/Only JPEG, PNG or WebP/);
    await expect(addImage(productId, png(120, 120), null, storage)).rejects.toThrow(/too small/);
    expect(await prisma.productImage.count({ where: { productId } })).toBe(0);
    await expect(fs.readdir(path.join(dir, 'products', String(productId)))).rejects.toThrow();
  });

  it(`stops at ${MAX_IMAGES_PER_PRODUCT} photos`, async () => {
    const { productId } = await makeFixture(1);
    for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i++) await addImage(productId, png(400, 400), null, storage);
    await expect(addImage(productId, png(400, 400), null, storage)).rejects.toThrow(/at most/);
  });

  it('moves a photo chosen as the main one to the front, keeping exactly one main', async () => {
    const { productId } = await makeFixture(1);
    const a = await addImage(productId, png(400, 400), null, storage);
    const b = await addImage(productId, png(400, 400), null, storage);
    const c = await addImage(productId, png(400, 400), null, storage);
    await updateImage(productId, c.id, { isPrimary: true });
    const list = await listImages(productId);
    expect(list.map((i) => [i.id, i.isPrimary])).toEqual([
      [c.id, true],
      [a.id, false],
      [b.id, false],
    ]);
  });

  it('reorders only when given every photo exactly once, and the first one becomes the main photo', async () => {
    const { productId } = await makeFixture(1);
    const a = await addImage(productId, png(400, 400), null, storage);
    const b = await addImage(productId, png(400, 400), null, storage);
    const c = await addImage(productId, png(400, 400), null, storage);

    const list = await reorderImages(productId, [c.id, a.id, b.id]);
    expect(list.map((i) => [i.id, i.isPrimary])).toEqual([
      [c.id, true],
      [a.id, false],
      [b.id, false],
    ]);
    await expect(reorderImages(productId, [c.id, a.id])).rejects.toThrow(/reload/);
    await expect(reorderImages(productId, [c.id, a.id, a.id])).rejects.toThrow(/reload/);
  });

  it("will not touch another product's photo", async () => {
    const one = await makeFixture(1);
    const two = await makeFixture(1);
    const img = await addImage(one.productId, png(400, 400), null, storage);
    await expect(updateImage(two.productId, img.id, { alt: 'x' })).rejects.toThrow(/not found/);
    await expect(deleteImage(two.productId, img.id, storage)).rejects.toThrow(/not found/);
  });

  it('deletes the file with the row, and hands the main photo to the next one', async () => {
    const { productId } = await makeFixture(1);
    const a = await addImage(productId, png(400, 400), null, storage);
    const b = await addImage(productId, png(400, 400), null, storage);
    const keyA = (await prisma.productImage.findUniqueOrThrow({ where: { id: a.id } })).storageKey!;

    const left = await deleteImage(productId, a.id, storage);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: b.id, isPrimary: true });
    expect(await exists(keyA)).toBe(false);
  });
});
