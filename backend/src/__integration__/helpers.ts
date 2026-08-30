/**
 * Fixtures for the integration suite. Every test file gets its own isolated
 * product/variant rows so suites can run in any order without colliding.
 */
process.env.DATABASE_URL =
  process.env.SHOP_TEST_DATABASE_URL || process.env.DATABASE_URL || '';

import prisma from '../config/database';

export const HAS_DB = Boolean(process.env.SHOP_TEST_DATABASE_URL);

/** `describe` that quietly skips when no test database is configured. */
export const describeDb = HAS_DB ? describe : describe.skip;

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${process.pid}-${seq++}`;

export interface Fixture {
  branchId: number;
  variantId: number;
  productId: number;
  userId: number;
}

/** Create a branch, product and one variant with `quantity` units on hand. */
export async function makeFixture(quantity: number): Promise<Fixture> {
  const tag = uid();

  const branch = await prisma.branch.create({
    data: { name: `Test ${tag}`, code: `T-${tag}` },
  });

  const brand = await prisma.brand.create({
    data: { name: `Brand ${tag}`, slug: `brand-${tag}` },
  });

  const category = await prisma.category.create({
    data: { name: `Frocks ${tag}`, slug: `frocks-${tag}` },
  });

  const product = await prisma.product.create({
    data: {
      brandId: brand.id,
      categoryId: category.id,
      name: `Peach frock ${tag}`,
      slug: `peach-frock-${tag}`,
      mrp: 1650,
      basePrice: 1450,
      costPrice: 800,
      onlineVisible: true,
      priceIncludesTax: true,
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `SKU-${tag}`,
      size: '24',
      color: 'Peach',
      barcode: `BC-${tag}`,
      priceOverride: 1450,
      mrpOverride: 1650,
    },
  });

  await prisma.inventory.create({
    data: { variantId: variant.id, branchId: branch.id, quantity },
  });

  const user = await prisma.user.create({
    data: {
      branchId: branch.id,
      email: `staff-${tag}@example.com`,
      passwordHash: 'x',
      firstName: 'Test',
      role: 'cashier',
    },
  });

  return {
    branchId: branch.id,
    variantId: variant.id,
    productId: product.id,
    userId: user.id,
  };
}

export { prisma };
