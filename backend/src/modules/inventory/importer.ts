import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

// ─── Types ───────────────────────────────────────────────────────

export interface ImportRow {
  rowNum: number;
  productName: string;
  brand: string;
  category: string;
  size: string;
  color: string;
  sku: string;
  barcode: string;
  // §13.3 — MRP is the printed list price POS actually charges. Sale Price
  // (basePrice) is MRP − 10%. Every price the sheet carries is stored so the
  // load never drops one (this was the SE0636x undercharge bug: only the Sale
  // Price was imported, MRP was lost, so POS fell back to a wrong product MRP).
  mrp: number;
  basePrice: number;          // Sale Price (MRP − 10% when omitted)
  costPrice: number;
  landingPrice: number | null;
  taxRate: number;
  mrpOverride: number | null; // per-variant MRP
  priceOverride: number | null; // per-variant Sale Price
  costOverride: number | null;
  clearancePrice: number | null;
  quantity: number;
  minStockLevel: number;
}

export interface RowValidation extends ImportRow {
  errors: string[];
  warnings: string[];
}

export interface ParseResult {
  rows: RowValidation[];
  totalRows: number;
  validRows: number;
  errorRows: number;
}

export interface ImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  inventoryUpdated: number;
  errors: Array<{ rowNum: number; error: string }>;
}

// ─── Required columns ────────────────────────────────────────────
// MRP is the primary price; a sheet may instead carry only "Sale Price"/"Base
// Price" (MRP is then derived). Cost Price is always required. Structural
// (non-price) columns are all required.

const STRUCTURAL_REQUIRED = [
  'Product Name',
  'Brand',
  'Category',
  'Size',
  'Color',
  'SKU',
  'Barcode',
  'Cost Price',
];

const COLUMN_MAP: Record<string, keyof ImportRow> = {
  'Product Name': 'productName',
  'Brand': 'brand',
  'Category': 'category',
  'Size': 'size',
  'Color': 'color',
  'SKU': 'sku',
  'Barcode': 'barcode',
  'MRP': 'mrp',
  'Sale Price': 'basePrice',
  'Base Price': 'basePrice', // legacy alias for Sale Price
  'Cost Price': 'costPrice',
  'Landing Price': 'landingPrice',
  'Tax Rate': 'taxRate',
  'MRP Override': 'mrpOverride',
  'Price Override': 'priceOverride',
  'Cost Override': 'costOverride',
  'Clearance Price': 'clearancePrice',
  'Quantity': 'quantity',
  'Min Stock Level': 'minStockLevel',
};

// §13.3 — Sale Price is MRP − 10%, rounded to the nearest rupee (matches the
// manual product form). Kept in one place so import and UI never drift.
const saleFromMrp = (mrp: number) => Math.round(mrp * 0.9);
const mrpFromSale = (sale: number) => Math.round(sale / 0.9);

// Parse a possibly-blank numeric cell → number, or null when empty/invalid.
function toNum(v: any): number | null {
  if (v === '' || v === undefined || v === null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ─── Parse Excel buffer → rows ───────────────────────────────────

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new AppError('Excel file has no sheets', 400);

  const sheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    throw new AppError('Excel sheet is empty (no data rows found)', 400);
  }

  // Validate required columns exist
  const headers = Object.keys(rawRows[0]);
  const hasCol = (name: string) =>
    headers.some((h) => h.trim().toLowerCase() === name.toLowerCase());
  const missing = STRUCTURAL_REQUIRED.filter((col) => !hasCol(col));
  // A price anchor is required: MRP (preferred) or a Sale/Base Price to derive it.
  if (!hasCol('MRP') && !hasCol('Sale Price') && !hasCol('Base Price')) {
    missing.push('MRP (or Sale Price)');
  }
  if (missing.length > 0) {
    throw new AppError(
      `Missing required columns: ${missing.join(', ')}. Download the template for the expected format.`,
      400
    );
  }

  // Normalize header matching (case-insensitive)
  const headerLookup = new Map<string, string>();
  for (const h of headers) {
    for (const [expected, field] of Object.entries(COLUMN_MAP)) {
      if (h.trim().toLowerCase() === expected.toLowerCase()) {
        headerLookup.set(h, field);
      }
    }
  }

  const rows: RowValidation[] = rawRows.map((raw, idx) => {
    const row: any = { rowNum: idx + 2 }; // +2 = 1-based + header row
    for (const [rawHeader, field] of headerLookup) {
      row[field] = raw[rawHeader];
    }

    // ── Price coercion (§13.3: MRP is primary, Sale Price = MRP − 10%) ──
    const mrp0 = toNum(row.mrp);
    const base0 = toNum(row.basePrice);
    if (mrp0 != null && mrp0 > 0) {
      row.mrp = mrp0;
      row.basePrice = base0 != null && base0 > 0 ? base0 : saleFromMrp(mrp0);
    } else if (base0 != null && base0 > 0) {
      // No MRP given — derive it from the Sale Price so POS charges correctly.
      row.basePrice = base0;
      row.mrp = mrpFromSale(base0);
    } else {
      row.mrp = 0;
      row.basePrice = 0;
    }
    row.costPrice = parseFloat(row.costPrice) || 0;
    row.landingPrice = toNum(row.landingPrice);
    row.taxRate = row.taxRate !== '' && row.taxRate !== undefined ? parseFloat(row.taxRate) : 18;

    // ── Per-variant overrides. Keep MRP-Override and Price-Override in step:
    //    supplying either fills the other (MRP − 10%). Deriving the MRP override
    //    from a lone Price Override is what prevents the undercharge bug. ──
    let mrpOv = toNum(row.mrpOverride);
    let priceOv = toNum(row.priceOverride);
    if (mrpOv != null && mrpOv > 0 && (priceOv == null || priceOv <= 0)) {
      priceOv = saleFromMrp(mrpOv);
    } else if (priceOv != null && priceOv > 0 && (mrpOv == null || mrpOv <= 0)) {
      mrpOv = mrpFromSale(priceOv);
    }
    row.mrpOverride = mrpOv;
    row.priceOverride = priceOv;
    row.costOverride = toNum(row.costOverride);
    row.clearancePrice = toNum(row.clearancePrice);

    row.quantity = parseInt(row.quantity, 10) || 0;
    row.minStockLevel = parseInt(row.minStockLevel, 10);
    if (isNaN(row.minStockLevel)) row.minStockLevel = 0; // §bug8 default 0

    // Trim strings
    for (const f of ['productName', 'brand', 'category', 'size', 'color', 'sku', 'barcode']) {
      row[f] = String(row[f] ?? '').trim();
    }

    // Validate
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!row.productName) errors.push('Product Name is required');
    if (!row.brand) errors.push('Brand is required');
    if (!row.category) errors.push('Category is required');
    if (!row.size) errors.push('Size is required');
    if (!row.color) errors.push('Color is required');
    if (!row.sku) errors.push('SKU is required');
    if (!row.barcode) errors.push('Barcode is required');
    if (row.mrp <= 0) errors.push('MRP (or Sale Price) must be > 0');
    if (row.costPrice <= 0) errors.push('Cost Price must be > 0');
    if (row.taxRate < 0 || row.taxRate > 100) errors.push('Tax Rate must be 0-100');
    if (row.quantity < 0) errors.push('Quantity cannot be negative');

    if (row.costPrice > row.basePrice) warnings.push('Cost Price > Sale Price');
    if (row.basePrice > row.mrp) warnings.push('Sale Price > MRP');
    if (row.mrpOverride != null && row.priceOverride != null && row.priceOverride > row.mrpOverride) {
      warnings.push('Price Override > MRP Override');
    }

    return { ...row, errors, warnings } as RowValidation;
  });

  // Check for duplicate SKUs/barcodes within the file
  const skuCount = new Map<string, number[]>();
  const barcodeCount = new Map<string, number[]>();
  for (const r of rows) {
    if (r.sku) {
      const arr = skuCount.get(r.sku) ?? [];
      arr.push(r.rowNum);
      skuCount.set(r.sku, arr);
    }
    if (r.barcode) {
      const arr = barcodeCount.get(r.barcode) ?? [];
      arr.push(r.rowNum);
      barcodeCount.set(r.barcode, arr);
    }
  }
  for (const r of rows) {
    const skuRows = skuCount.get(r.sku);
    if (skuRows && skuRows.length > 1) {
      r.errors.push(`Duplicate SKU "${r.sku}" in rows ${skuRows.join(', ')}`);
    }
    const bcRows = barcodeCount.get(r.barcode);
    if (bcRows && bcRows.length > 1) {
      r.errors.push(`Duplicate Barcode "${r.barcode}" in rows ${bcRows.join(', ')}`);
    }
  }

  const validRows = rows.filter((r) => r.errors.length === 0).length;
  return {
    rows,
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
  };
}

// ─── Execute import: upsert products, variants, inventory ────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function executeImport(
  rows: ImportRow[],
  branchId: number,
  userId: number
): Promise<ImportResult> {
  const result: ImportResult = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    inventoryUpdated: 0,
    errors: [],
  };

  return prisma.$transaction(
    async (tx) => {
      // 1. Resolve brands — find or create
      const brandNames = [...new Set(rows.map((r) => r.brand))];
      const brandMap = new Map<string, number>();
      for (const name of brandNames) {
        const existing = await tx.brand.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          brandMap.set(name, existing.id);
        } else {
          const created = await tx.brand.create({
            data: { name, slug: slugify(name) },
          });
          brandMap.set(name, created.id);
        }
      }

      // 2. Resolve categories — find or create
      const categoryNames = [...new Set(rows.map((r) => r.category))];
      const categoryMap = new Map<string, number>();
      for (const name of categoryNames) {
        const existing = await tx.category.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          categoryMap.set(name, existing.id);
        } else {
          const created = await tx.category.create({
            data: { name, slug: slugify(name) },
          });
          categoryMap.set(name, created.id);
        }
      }

      // 3. Group rows by product (name + brand + category)
      const productKey = (r: ImportRow) =>
        `${r.productName.toLowerCase()}|${r.brand.toLowerCase()}|${r.category.toLowerCase()}`;
      const groups = new Map<string, ImportRow[]>();
      for (const r of rows) {
        const key = productKey(r);
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }

      // 4. Upsert products + variants + inventory
      for (const [, group] of groups) {
        const first = group[0];
        const brandId = brandMap.get(first.brand)!;
        const categoryId = categoryMap.get(first.category)!;

        // Find existing product
        let product = await tx.product.findFirst({
          where: {
            name: { equals: first.productName, mode: 'insensitive' },
            brandId,
            categoryId,
          },
        });

        // Excel "Tax Rate" column is the combined GST rate; split half/half
        // into CGST + SGST per Indian intra-state convention.
        const halfRate = Math.round((first.taxRate / 2) * 100) / 100;

        // §13.3 — store the full product price stack: MRP (charged), Sale Price
        // (basePrice), Cost and Landing. MRP/landing are product-level; per-size
        // differences ride on the variant overrides below.
        const productPricing = {
          mrp: first.mrp,
          basePrice: first.basePrice,
          costPrice: first.costPrice,
          landingPrice: first.landingPrice,
          cgstRate: halfRate,
          sgstRate: first.taxRate - halfRate,
        };

        if (product) {
          await tx.product.update({
            where: { id: product.id },
            data: productPricing,
          });
          result.productsUpdated++;
        } else {
          const slug =
            slugify(`${first.productName}-${first.brand}`) +
            '-' +
            Date.now().toString(36);
          product = await tx.product.create({
            data: {
              name: first.productName,
              slug,
              brandId,
              categoryId,
              ...productPricing,
            },
          });
          result.productsCreated++;
        }

        // Variants
        for (const row of group) {
          try {
            // A row whose MRP differs from the product's MRP is a per-size price
            // and is stored as an explicit variant override (even if the sheet
            // didn't fill the dedicated Override column), so POS charges it.
            const mrpOverride =
              row.mrpOverride ?? (row.mrp !== first.mrp ? row.mrp : null);
            const priceOverride =
              row.priceOverride ?? (row.basePrice !== first.basePrice ? row.basePrice : null);

            let variant = await tx.productVariant.findFirst({
              where: {
                OR: [{ sku: row.sku }, { barcode: row.barcode }],
              },
            });

            const variantPricing = {
              mrpOverride,
              priceOverride,
              costOverride: row.costOverride,
              clearancePrice: row.clearancePrice,
            };

            if (variant) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: {
                  size: row.size,
                  color: row.color,
                  sku: row.sku,
                  barcode: row.barcode,
                  ...variantPricing,
                },
              });
              result.variantsUpdated++;
            } else {
              variant = await tx.productVariant.create({
                data: {
                  productId: product.id,
                  sku: row.sku,
                  barcode: row.barcode,
                  size: row.size,
                  color: row.color,
                  ...variantPricing,
                },
              });
              result.variantsCreated++;
            }

            // Upsert inventory
            await tx.inventory.upsert({
              where: {
                variantId_branchId: {
                  variantId: variant.id,
                  branchId,
                },
              },
              create: {
                variantId: variant.id,
                branchId,
                quantity: row.quantity,
                minStockLevel: row.minStockLevel,
              },
              update: {
                quantity: row.quantity,
                minStockLevel: row.minStockLevel,
              },
            });
            result.inventoryUpdated++;
          } catch (err: any) {
            result.errors.push({
              rowNum: row.rowNum,
              error: err.message || 'Unknown error',
            });
          }
        }
      }

      return result;
    },
    { timeout: 60000 } // allow up to 60s for large imports
  );
}

// ─── Generate template workbook buffer ───────────────────────────

export function generateTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  // §13.3 — MRP is the primary price (what POS charges). Sale Price auto-fills to
  // MRP − 10% if left blank. Per-size prices go in MRP Override (Price/Cost
  // Override and Clearance Price are optional per-variant fields).
  const sampleData = [
    {
      'Product Name': 'Levis 501 Original Jeans',
      Brand: 'Levis',
      Category: 'Jeans',
      Size: '32',
      Color: 'Blue',
      SKU: 'LEV-501-32-BLU',
      Barcode: '8901234567890',
      MRP: 3999,
      'Sale Price': '', // blank → auto 3599 (MRP − 10%)
      'Cost Price': 2200,
      'Landing Price': 2350,
      'Tax Rate': 18,
      'MRP Override': '',
      'Price Override': '',
      'Cost Override': '',
      'Clearance Price': '',
      Quantity: 25,
      'Min Stock Level': 5,
    },
    {
      'Product Name': 'Levis 501 Original Jeans',
      Brand: 'Levis',
      Category: 'Jeans',
      Size: '36',
      Color: 'Blue',
      SKU: 'LEV-501-36-BLU',
      Barcode: '8901234567891',
      MRP: 3999,
      'Sale Price': '',
      'Cost Price': 2200,
      'Landing Price': 2350,
      'Tax Rate': 18,
      'MRP Override': 4299, // this size costs more → per-variant MRP
      'Price Override': '',
      'Cost Override': '',
      'Clearance Price': '',
      Quantity: 30,
      'Min Stock Level': 5,
    },
    {
      'Product Name': 'Nike Dri-FIT Polo',
      Brand: 'Nike',
      Category: 'T-Shirts',
      Size: 'M',
      Color: 'White',
      SKU: 'NIK-DRI-M-WHT',
      Barcode: '8901234567892',
      MRP: 2499,
      'Sale Price': 2199, // explicit Sale Price overrides the MRP − 10% default
      'Cost Price': 1400,
      'Landing Price': '',
      'Tax Rate': 18,
      'MRP Override': '',
      'Price Override': '',
      'Cost Override': '',
      'Clearance Price': 1799, // dead-stock liquidation price for this variant
      Quantity: 15,
      'Min Stock Level': 3,
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);

  // Set column widths
  ws['!cols'] = [
    { wch: 28 }, // Product Name
    { wch: 12 }, // Brand
    { wch: 12 }, // Category
    { wch: 8 },  // Size
    { wch: 12 }, // Color
    { wch: 20 }, // SKU
    { wch: 16 }, // Barcode
    { wch: 10 }, // MRP
    { wch: 12 }, // Sale Price
    { wch: 12 }, // Cost Price
    { wch: 14 }, // Landing Price
    { wch: 10 }, // Tax Rate
    { wch: 14 }, // MRP Override
    { wch: 14 }, // Price Override
    { wch: 14 }, // Cost Override
    { wch: 16 }, // Clearance Price
    { wch: 10 }, // Quantity
    { wch: 14 }, // Min Stock Level
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
