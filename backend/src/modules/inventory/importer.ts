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
  basePrice: number;
  costPrice: number;
  taxRate: number;
  priceOverride: number | null;
  costOverride: number | null;
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

const REQUIRED_COLUMNS = [
  'Product Name',
  'Brand',
  'Category',
  'Size',
  'Color',
  'SKU',
  'Barcode',
  'Base Price',
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
  'Base Price': 'basePrice',
  'Cost Price': 'costPrice',
  'Tax Rate': 'taxRate',
  'Price Override': 'priceOverride',
  'Cost Override': 'costOverride',
  'Quantity': 'quantity',
  'Min Stock Level': 'minStockLevel',
};

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
  const missing = REQUIRED_COLUMNS.filter(
    (col) => !headers.some((h) => h.trim().toLowerCase() === col.toLowerCase())
  );
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

    // Defaults and coercions
    row.basePrice = parseFloat(row.basePrice) || 0;
    row.costPrice = parseFloat(row.costPrice) || 0;
    row.taxRate = row.taxRate !== '' && row.taxRate !== undefined ? parseFloat(row.taxRate) : 18;
    row.priceOverride =
      row.priceOverride !== '' && row.priceOverride !== undefined
        ? parseFloat(row.priceOverride)
        : null;
    row.costOverride =
      row.costOverride !== '' && row.costOverride !== undefined
        ? parseFloat(row.costOverride)
        : null;
    row.quantity = parseInt(row.quantity, 10) || 0;
    row.minStockLevel = parseInt(row.minStockLevel, 10) || 5;

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
    if (row.basePrice <= 0) errors.push('Base Price must be > 0');
    if (row.costPrice <= 0) errors.push('Cost Price must be > 0');
    if (row.taxRate < 0 || row.taxRate > 100) errors.push('Tax Rate must be 0-100');
    if (row.quantity < 0) errors.push('Quantity cannot be negative');

    if (row.costPrice > row.basePrice) warnings.push('Cost Price > Base Price');

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

        if (product) {
          // Update base price / cost if they differ
          await tx.product.update({
            where: { id: product.id },
            data: {
              basePrice: first.basePrice,
              costPrice: first.costPrice,
              taxRate: first.taxRate,
            },
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
              basePrice: first.basePrice,
              costPrice: first.costPrice,
              taxRate: first.taxRate,
            },
          });
          result.productsCreated++;
        }

        // Variants
        for (const row of group) {
          try {
            let variant = await tx.productVariant.findFirst({
              where: {
                OR: [{ sku: row.sku }, { barcode: row.barcode }],
              },
            });

            if (variant) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: {
                  size: row.size,
                  color: row.color,
                  sku: row.sku,
                  barcode: row.barcode,
                  priceOverride: row.priceOverride,
                  costOverride: row.costOverride,
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
                  priceOverride: row.priceOverride,
                  costOverride: row.costOverride,
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
  const sampleData = [
    {
      'Product Name': 'Levis 501 Original Jeans',
      Brand: 'Levis',
      Category: 'Jeans',
      Size: '32',
      Color: 'Blue',
      SKU: 'LEV-501-32-BLU',
      Barcode: '8901234567890',
      'Base Price': 3999,
      'Cost Price': 2200,
      'Tax Rate': 18,
      'Price Override': '',
      'Cost Override': '',
      Quantity: 25,
      'Min Stock Level': 5,
    },
    {
      'Product Name': 'Levis 501 Original Jeans',
      Brand: 'Levis',
      Category: 'Jeans',
      Size: '34',
      Color: 'Blue',
      SKU: 'LEV-501-34-BLU',
      Barcode: '8901234567891',
      'Base Price': 3999,
      'Cost Price': 2200,
      'Tax Rate': 18,
      'Price Override': '',
      'Cost Override': '',
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
      'Base Price': 2499,
      'Cost Price': 1400,
      'Tax Rate': 18,
      'Price Override': 2299,
      'Cost Override': '',
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
    { wch: 12 }, // Base Price
    { wch: 12 }, // Cost Price
    { wch: 10 }, // Tax Rate
    { wch: 14 }, // Price Override
    { wch: 14 }, // Cost Override
    { wch: 10 }, // Quantity
    { wch: 14 }, // Min Stock Level
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
