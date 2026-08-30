/**
 * Demo catalogue for the storefront — kids ethnic wear across the real size
 * grid. Idempotent: safe to re-run.
 *
 *   DATABASE_URL=... npx ts-node prisma/seed-shop-demo.ts
 *
 * This is DEMO data for development and smoke tests, not production stock.
 */
import { PrismaClient } from '@prisma/client';
import { SHOP_SIZES } from '@clothing-erp/shared';

const prisma = new PrismaClient();

const PRODUCTS = [
  { name: 'Peach silk frock with mirror work',        cat: 'Frocks',        aud: 'girls', mrp: 1650, sale: 1450, sizes: ['16','18','20','22','24','26','28','30'], colour: 'Peach' },
  { name: 'Boys cotton kurta pyjama set, mustard',    cat: 'Kurta sets',    aud: 'boys',  mrp: 1400, sale: 1250, sizes: ['18','20','22','24','26','28','30','32'], colour: 'Mustard' },
  { name: 'Girls lehenga choli with net dupatta',     cat: 'Lehenga choli', aud: 'girls', mrp: 3200, sale: 2850, sizes: ['20','22','24','26','28','30','32','34'], colour: 'Rani pink' },
  { name: 'Cotton cord set, blue block print',        cat: 'Cord sets',     aud: 'girls', mrp: 1100, sale: 950,  sizes: ['12','14','16','18','20','22','24','26'], colour: 'Indigo' },
  { name: 'Boys sherwani with churidar, ivory',       cat: 'Sherwani',      aud: 'boys',  mrp: 3600, sale: 3200, sizes: ['22','24','26','28','30','32','34','36'], colour: 'Ivory' },
  { name: 'Anarkali frock with gota border, wine',    cat: 'Frocks',        aud: 'girls', mrp: 2100, sale: 1850, sizes: ['18','20','22','24','26','28','30','32'], colour: 'Wine' },
  { name: 'Girls dhoti kurta set, teal',              cat: 'Kurta sets',    aud: 'girls', mrp: 1500, sale: 1350, sizes: ['16','18','20','22','24','26','28'],      colour: 'Teal' },
  { name: 'Chikankari kurta set, ivory',              cat: 'Kurta sets',    aud: 'boys',  mrp: 1750, sale: 1550, sizes: ['20','22','24','26','28','30','32','34'], colour: 'Ivory' },
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

async function main() {
  const branch =
    (await prisma.branch.findFirst({ where: { code: 'MAIN' } })) ??
    (await prisma.branch.create({
      data: { name: "Sabiha's Ethnic — Nagpur", code: 'MAIN', address: 'Dharampeth Road, Nagpur' },
    }));

  const brand =
    (await prisma.brand.findFirst({ where: { slug: 'sabihas-ethnic' } })) ??
    (await prisma.brand.create({ data: { name: "Sabiha's Ethnic", slug: 'sabihas-ethnic' } }));

  // Sizes come from the shared assumptions file, which mirrors the shop's chart.
  for (const s of SHOP_SIZES) {
    await prisma.size.upsert({
      where: { name: s.name },
      create: {
        name: s.name, sortOrder: s.sortOrder, ageLabel: s.ageLabel,
        chestInches: s.chestInches, lengthInches: s.lengthInches,
        ageFromMonths: s.ageFromMonths, ageToMonths: s.ageToMonths,
      },
      update: {
        ageLabel: s.ageLabel, chestInches: s.chestInches, lengthInches: s.lengthInches,
        ageFromMonths: s.ageFromMonths, ageToMonths: s.ageToMonths, sortOrder: s.sortOrder,
      },
    });
  }

  let barcode = 900000001;

  for (const p of PRODUCTS) {
    const category =
      (await prisma.category.findFirst({ where: { slug: slugify(p.cat) } })) ??
      (await prisma.category.create({ data: { name: p.cat, slug: slugify(p.cat) } }));

    const slug = slugify(p.name);
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      console.log(`  = ${p.name} (already seeded)`);
      continue;
    }

    const product = await prisma.product.create({
      data: {
        brandId: brand.id,
        categoryId: category.id,
        name: p.name,
        slug,
        mrp: p.mrp,
        basePrice: p.sale,
        costPrice: Math.round(p.sale * 0.55),
        priceIncludesTax: true,
        onlineVisible: true,
        audience: p.aud,
        onlineDescription:
          'Fully lined in soft cotton so nothing scratches, with a little give at the waist ' +
          'for a child who intends to run about. Made to be worn, not just photographed.',
        metaTitle: p.name,
        metaDescription: `${p.name} — kids ethnic wear, sizes ${p.sizes[0]} to ${p.sizes[p.sizes.length - 1]}. Free delivery.`,
      },
    });

    // A placeholder image record so the product is listable. Real photography
    // replaces these — see PLAN.md §6.
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: `https://placehold.co/800x1000/f4ece5/bbaa9c?text=${encodeURIComponent(p.colour)}`,
        alt: p.name,
        width: 800,
        height: 1000,
        isPrimary: true,
      },
    });

    for (const size of p.sizes) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `${slug.slice(0, 8).toUpperCase()}-${size}`,
          size,
          color: p.colour,
          barcode: String(barcode++),
          mrpOverride: p.mrp,
          priceOverride: p.sale,
          onlineSellable: true,
        },
      });

      // A realistic spread: most sizes in stock, the odd one sold out.
      const qty = size === '26' && p.name.startsWith('Peach') ? 0 : Math.floor(Math.random() * 4) + 1;
      await prisma.inventory.create({
        data: { variantId: variant.id, branchId: branch.id, quantity: qty },
      });
    }

    console.log(`  + ${p.name} (${p.sizes.length} sizes)`);
  }

  console.log('\nDemo catalogue ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
