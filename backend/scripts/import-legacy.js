/**
 * Legacy data migration — Phase 1 (Closing Stock) + Phase 2 (Customers)
 *
 * Source: "Data for Tax Year 2026-2027.xlsx" exported from the previous
 * retail package. Reads the workbook and loads:
 *   - Brands / Products / Variants / Inventory   (from the Closing Stock sheet)
 *   - Customers                                   (from the Customer Directory sheet)
 *
 * Idempotent: brands/products/variants keyed by natural keys (item code, name),
 * customers keyed by phone. Safe to re-run.
 *
 * Usage:
 *   node scripts/import-legacy.js /path/to/file.xlsx [--stock] [--customers] [--commit]
 *   (no phase flag = both phases; without --commit it's a DRY RUN)
 */
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith('--'));
const COMMIT = args.includes('--commit');
const doStock = args.includes('--stock') || (!args.includes('--stock') && !args.includes('--customers'));
const doCust = args.includes('--customers') || (!args.includes('--stock') && !args.includes('--customers'));

const BRANCH_ID = 1; // Main Store — closing stock loads here
const STOCK_SHEET = 'Exsisting StockCLOSING STOCK - ';
const CUST_SHEET = 'CUSTOMER DIRECTORY';
const DEFAULT_CATEGORY = 'Uncategorized';
const GST_TOTAL = 5; // most legacy sales were GST 5%; split 2.5 / 2.5

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function normPhone(v) {
  if (v == null) return '';
  return String(v).replace(/\D/g, '');
}

async function main() {
  if (!FILE) throw new Error('Provide the xlsx path as the first argument');
  const wb = XLSX.readFile(FILE);
  console.log(`\n${COMMIT ? '=== COMMIT ===' : '=== DRY RUN (no --commit) ==='}  file: ${path.basename(FILE)}`);

  const summary = {};

  // ─── ensure default category exists (config kept from before, but be safe) ───
  let uncat = null;
  if (doStock) {
    uncat = await prisma.category.findFirst({ where: { name: DEFAULT_CATEGORY } });
    if (!uncat && COMMIT) {
      uncat = await prisma.category.create({ data: { name: DEFAULT_CATEGORY, slug: slugify(DEFAULT_CATEGORY) } });
    }
  }

  // ─────────────────────────── PHASE 1: STOCK ───────────────────────────
  if (doStock) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[STOCK_SHEET], { header: 1, blankrows: false, defval: null }).slice(2);
    const items = rows.filter(
      (r) => r[2] && r[1] && !String(r[1]).includes('Total') && !String(r[1]).includes('Wise')
    );

    // resolve brands
    const brandNames = [...new Set(items.map((r) => String(r[1]).trim()))];
    const brandMap = new Map();
    for (const name of brandNames) {
      let b = await prisma.brand.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (!b && COMMIT) b = await prisma.brand.create({ data: { name, slug: slugify(name) + '-' + Math.random().toString(36).slice(2, 6) } });
      brandMap.set(name, b ? b.id : -1);
    }

    // group by brand + item name -> one product; rows within = size variants
    const groups = new Map();
    for (const r of items) {
      const key = String(r[1]).trim() + '||' + String(r[3]).trim();
      (groups.get(key) || groups.set(key, []).get(key)).push(r);
    }

    let pCreated = 0, vCreated = 0, invCreated = 0, vSkipped = 0;
    for (const [key, group] of groups) {
      const first = group[0];
      const brand = String(first[1]).trim();
      const name = String(first[3]).trim();
      const brandId = brandMap.get(brand);
      const mrp = Number(first[8]) || 0;
      const cost = Number(first[6]) || 0;
      const basePrice = Math.round(mrp * 0.9 * 100) / 100; // §13.3 MRP − 10%

      let product = null;
      if (COMMIT) {
        product = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, brandId } });
        if (!product) {
          product = await prisma.product.create({
            data: {
              name, slug: slugify(`${name}-${brand}`) + '-' + Math.random().toString(36).slice(2, 7),
              brandId, categoryId: uncat.id,
              mrp, basePrice: basePrice || mrp || 1, costPrice: cost,
              cgstRate: GST_TOTAL / 2, sgstRate: GST_TOTAL / 2, priceIncludesTax: true,
            },
          });
          pCreated++;
        }
      } else { pCreated++; }

      for (const r of group) {
        const code = String(r[2]).trim();
        const size = String(r[4]).trim();
        const color = String(name).split(/\s+/).pop() || '-';
        const qty = Number(r[5]) || 0;
        const itemMrp = Number(r[8]) || mrp;
        if (COMMIT) {
          const exists = await prisma.productVariant.findFirst({ where: { OR: [{ sku: code }, { barcode: code }] } });
          if (exists) { vSkipped++; continue; }
          const v = await prisma.productVariant.create({
            data: {
              productId: product.id, sku: code, barcode: code, size, color,
              priceOverride: itemMrp !== mrp ? Math.round(itemMrp * 0.9 * 100) / 100 : null,
            },
          });
          await prisma.inventory.create({ data: { variantId: v.id, branchId: BRANCH_ID, quantity: qty } });
          vCreated++; invCreated++;
        } else { vCreated++; invCreated++; }
      }
    }
    summary.stock = { items: items.length, brands: brandNames.length, products: pCreated, variants: vCreated, variantsSkipped: vSkipped, inventory: invCreated };
  }

  // ─────────────────────────── PHASE 2: CUSTOMERS ───────────────────────────
  if (doCust) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[CUST_SHEET], { header: 1, blankrows: false, defval: null }).slice(2);
    const custs = rows.filter((r) => r[1]); // has a name
    let created = 0, skippedNoPhone = 0, skippedDup = 0, skippedExisting = 0;
    const seen = new Set();
    for (const r of custs) {
      const first = String(r[2] || r[1]).trim();
      const phoneRaw = normPhone(r[14]);
      const phone = phoneRaw.length > 10 ? phoneRaw.slice(-10) : phoneRaw; // strip country/leading digits
      if (!phone || phone.length < 10) { skippedNoPhone++; continue; }
      if (seen.has(phone)) { skippedDup++; continue; }
      seen.add(phone);
      const sex = String(r[19] || '').toUpperCase();
      const gender = sex === 'MALE' ? 'M' : sex === 'FEMALE' ? 'F' : null;
      if (COMMIT) {
        const exists = await prisma.customer.findUnique({ where: { phone } });
        if (exists) { skippedExisting++; continue; }
        await prisma.customer.create({ data: { firstName: first || 'Customer', phone, gender } });
      }
      created++;
    }
    summary.customers = { rows: custs.length, imported: created, skippedNoPhone, skippedDuplicatePhone: skippedDup, skippedAlreadyInDb: skippedExisting };
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!COMMIT) console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
