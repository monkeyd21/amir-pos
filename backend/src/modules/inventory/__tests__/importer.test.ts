import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../importer';

// Build an .xlsx buffer from an array of row objects (header = keys of first row).
function sheetBuffer(rows: Record<string, any>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const base = {
  'Product Name': 'CORD KURTI',
  Brand: 'House',
  Category: 'Kurti',
  Size: '32',
  Color: 'Mustard',
  SKU: 'SE00001',
  Barcode: 'SE00001',
  'Cost Price': 500,
  'Tax Rate': 12,
  Quantity: 5,
  'Min Stock Level': 1,
};

describe('inventory importer — pricing (§13.3)', () => {
  it('treats MRP as primary and derives Sale Price = MRP − 10%', () => {
    const { rows } = parseExcelBuffer(sheetBuffer([{ ...base, MRP: 950 }]));
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].mrp).toBe(950);
    expect(rows[0].basePrice).toBe(855); // 950 × 0.9
  });

  it('keeps an explicit Sale Price when provided alongside MRP', () => {
    const { rows } = parseExcelBuffer(sheetBuffer([{ ...base, MRP: 1000, 'Sale Price': 880 }]));
    expect(rows[0].mrp).toBe(1000);
    expect(rows[0].basePrice).toBe(880);
  });

  it('derives MRP from a Sale-Price-only sheet so POS never undercharges', () => {
    const { rows } = parseExcelBuffer(sheetBuffer([{ ...base, 'Sale Price': 855 }]));
    expect(rows[0].basePrice).toBe(855);
    expect(rows[0].mrp).toBe(950); // round(855 / 0.9)
  });

  it('accepts the legacy "Base Price" header as Sale Price', () => {
    const { rows } = parseExcelBuffer(sheetBuffer([{ ...base, 'Base Price': 720 }]));
    expect(rows[0].basePrice).toBe(720);
    expect(rows[0].mrp).toBe(800);
  });

  it('derives a variant MRP Override from a lone Price Override (the SE0636x bug)', () => {
    const { rows } = parseExcelBuffer(
      sheetBuffer([{ ...base, MRP: 770, 'Price Override': 855 }])
    );
    expect(rows[0].priceOverride).toBe(855);
    expect(rows[0].mrpOverride).toBe(950); // round(855 / 0.9) — POS will charge 950, not 770
  });

  it('captures Landing Price, Cost Override and Clearance Price', () => {
    const { rows } = parseExcelBuffer(
      sheetBuffer([
        {
          ...base,
          MRP: 1200,
          'Landing Price': 640,
          'Cost Override': 520,
          'Clearance Price': 899,
        },
      ])
    );
    expect(rows[0].landingPrice).toBe(640);
    expect(rows[0].costOverride).toBe(520);
    expect(rows[0].clearancePrice).toBe(899);
  });

  it('fails when neither MRP nor Sale/Base Price column is present', () => {
    expect(() => parseExcelBuffer(sheetBuffer([base]))).toThrow(/MRP \(or Sale Price\)/);
  });

  it('warns when Sale Price exceeds MRP', () => {
    const { rows } = parseExcelBuffer(
      sheetBuffer([{ ...base, MRP: 800, 'Sale Price': 900 }])
    );
    expect(rows[0].warnings).toContain('Sale Price > MRP');
  });
});
