import crypto from 'crypto';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { MediaStorage, mediaStorage } from '../../services/media-storage';
import { IMAGE_CONTENT_TYPES, IMAGE_EXTENSIONS, readImageMeta } from './image-meta';

/**
 * Product photos for the storefront and the ERP.
 *
 * A product has an ordered list of pictures, and the FIRST one is the main
 * photo: the storefront's product card and the first picture on its product
 * page. `isPrimary` is kept in step with position 0 on every change, so the
 * order the shop sets in the ERP is exactly the order a shopper sees. Choosing
 * a main photo therefore moves it to the front; deleting the main photo hands
 * the role to the next one.
 */

export const MAX_IMAGES_PER_PRODUCT = 12;
/** The browser shrinks photos before sending, so anything near this is a mistake. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_EDGE = 200;
const MAX_EDGE = 6000;

const ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Write `ids` as the order, with the first one the main photo. */
async function applyOrder(tx: Tx, ids: number[]) {
  for (const [index, id] of ids.entries()) {
    await tx.productImage.update({ where: { id }, data: { sortOrder: index, isPrimary: index === 0 } });
  }
}

const PUBLIC_FIELDS = {
  id: true,
  url: true,
  alt: true,
  width: true,
  height: true,
  sortOrder: true,
  isPrimary: true,
  createdAt: true,
};

async function requireProduct(productId: number) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new AppError('Product not found', 404);
}

async function requireImage(productId: number, imageId: number) {
  const image = await prisma.productImage.findFirst({ where: { id: imageId, productId } });
  if (!image) throw new AppError('Photo not found', 404);
  return image;
}

export async function listImages(productId: number) {
  await requireProduct(productId);
  return prisma.productImage.findMany({ where: { productId }, orderBy: ORDER, select: PUBLIC_FIELDS });
}

export async function addImage(
  productId: number,
  body: Buffer,
  alt: string | null | undefined,
  storage: MediaStorage = mediaStorage
) {
  await requireProduct(productId);

  if (body.length > MAX_IMAGE_BYTES) throw new AppError('That photo is too large (8 MB at most)', 400);
  const meta = readImageMeta(body);
  if (!meta) throw new AppError('Only JPEG, PNG or WebP photos can be added', 400);
  if (Math.min(meta.width, meta.height) < MIN_EDGE) {
    throw new AppError(`That photo is too small (${meta.width}×${meta.height}); use one at least ${MIN_EDGE}px on each side`, 400);
  }
  if (Math.max(meta.width, meta.height) > MAX_EDGE) {
    throw new AppError(`That photo is too large (${meta.width}×${meta.height}); ${MAX_EDGE}px on the longest side at most`, 400);
  }

  const count = await prisma.productImage.count({ where: { productId } });
  if (count >= MAX_IMAGES_PER_PRODUCT) {
    throw new AppError(`A product can have ${MAX_IMAGES_PER_PRODUCT} photos at most; delete one first`, 400);
  }

  const key = `products/${productId}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[meta.kind]}`;
  await storage.put(key, body, IMAGE_CONTENT_TYPES[meta.kind]);

  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'desc' } });
      return tx.productImage.create({
        data: {
          productId,
          url: storage.publicUrl(key),
          storageKey: key,
          alt: alt?.trim() || null,
          width: meta.width,
          height: meta.height,
          sortOrder: last ? last.sortOrder + 1 : 0,
          isPrimary: !last,
        },
        select: PUBLIC_FIELDS,
      });
    });
  } catch (err) {
    // No row points at the file, so do not leave it behind.
    await storage.remove(key).catch(() => undefined);
    throw err;
  }
}

export async function updateImage(
  productId: number,
  imageId: number,
  patch: { alt?: string | null; isPrimary?: boolean }
) {
  await requireImage(productId, imageId);

  return prisma.$transaction(async (tx) => {
    if (patch.isPrimary === true) {
      // The main photo is the first one, so choosing it moves it to the front.
      const rest = await tx.productImage.findMany({
        where: { productId, NOT: { id: imageId } },
        orderBy: ORDER,
        select: { id: true },
      });
      await applyOrder(tx, [imageId, ...rest.map((r) => r.id)]);
    }
    if (patch.alt !== undefined) {
      await tx.productImage.update({ where: { id: imageId }, data: { alt: patch.alt?.trim() || null } });
    }
    return tx.productImage.findUniqueOrThrow({ where: { id: imageId }, select: PUBLIC_FIELDS });
  });
}

/** `ids` must name every photo of the product exactly once, in the new order. */
export async function reorderImages(productId: number, ids: number[]) {
  await requireProduct(productId);
  const current = await prisma.productImage.findMany({ where: { productId }, select: { id: true } });
  const known = new Set(current.map((i) => i.id));
  const given = new Set(ids);
  if (given.size !== ids.length || given.size !== known.size || ids.some((id) => !known.has(id))) {
    throw new AppError('The photo list changed while you were editing; reload and try again', 409);
  }

  await prisma.$transaction((tx) => applyOrder(tx, ids));
  return listImages(productId);
}

export async function deleteImage(productId: number, imageId: number, storage: MediaStorage = mediaStorage) {
  const image = await requireImage(productId, imageId);

  await prisma.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });
    const rest = await tx.productImage.findMany({ where: { productId }, orderBy: ORDER, select: { id: true } });
    await applyOrder(tx, rest.map((r) => r.id));
  });

  // After the row is gone: a file without a row is harmless clutter, a row
  // without its file is a broken picture on the shop.
  if (image.storageKey) {
    await storage.remove(image.storageKey).catch((err) => {
      console.error(`[images] could not delete ${image.storageKey}:`, err);
    });
  }
  return listImages(productId);
}
