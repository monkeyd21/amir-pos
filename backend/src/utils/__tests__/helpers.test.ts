import { generateEAN13, generateSKU, slugify, getPagination, buildPaginationMeta } from '../helpers';

describe('Utils / Helpers', () => {
  // ─── generateEAN13 ──────────────────────────────────────────────
  describe('generateEAN13', () => {
    it('should produce a 13-digit string', () => {
      const barcode = generateEAN13();
      expect(barcode).toHaveLength(13);
      expect(/^\d{13}$/.test(barcode)).toBe(true);
    });

    it('should start with the given prefix', () => {
      const barcode = generateEAN13('300');
      expect(barcode.startsWith('300')).toBe(true);
    });

    it('should use default prefix "200" when none provided', () => {
      const barcode = generateEAN13();
      expect(barcode.startsWith('200')).toBe(true);
    });

    it('should generate a valid EAN-13 check digit', () => {
      const barcode = generateEAN13();
      const digits = barcode.split('').map(Number);

      // Recalculate check digit
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += digits[i] * (i % 2 === 0 ? 1 : 3);
      }
      const expectedCheck = (10 - (sum % 10)) % 10;
      expect(digits[12]).toBe(expectedCheck);
    });

    it('should produce unique barcodes across multiple calls', () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) {
        set.add(generateEAN13());
      }
      // Statistically all 50 should be unique (collision chance negligible)
      expect(set.size).toBe(50);
    });
  });

  // ─── generateSKU ────────────────────────────────────────────────
  describe('generateSKU', () => {
    it('should follow the format BRA-NAM-SIZE-COL-RAND', () => {
      const sku = generateSKU('Nike', 'Running Shoes', 'XL', 'Black');
      const parts = sku.split('-');
      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe('NIK'); // first 3 of brand
      expect(parts[1]).toBe('RUN'); // first 3 of name
      expect(parts[2]).toBe('XL');  // size uppercased
      expect(parts[3]).toBe('BLA'); // first 3 of color
      expect(parts[4]).toHaveLength(4); // 2 random hex bytes = 4 chars
    });

    it('should uppercase all segments', () => {
      const sku = generateSKU('adidas', 'polo', 'm', 'red');
      expect(sku).toMatch(/^[A-Z0-9-]+$/);
    });

    it('should handle short inputs gracefully', () => {
      const sku = generateSKU('AB', 'XY', 'S', 'RD');
      const parts = sku.split('-');
      expect(parts[0]).toBe('AB');
      expect(parts[1]).toBe('XY');
      expect(parts[2]).toBe('S');
      expect(parts[3]).toBe('RD');
    });
  });

  // ─── slugify ────────────────────────────────────────────────────
  describe('slugify', () => {
    it('should lowercase and hyphenate', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should strip special characters', () => {
      expect(slugify('Men\'s T-Shirt (2024)!')).toBe('mens-t-shirt-2024');
    });

    it('should collapse multiple spaces/dashes', () => {
      expect(slugify('  A   B---C  ')).toBe('a-b-c');
    });

    it('should handle empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('should handle underscores', () => {
      expect(slugify('hello_world_test')).toBe('hello-world-test');
    });
  });

  // ─── getPagination ──────────────────────────────────────────────
  describe('getPagination', () => {
    it('should return defaults for empty query', () => {
      const result = getPagination({});
      expect(result).toEqual({ page: 1, limit: 20, skip: 0 });
    });

    it('should parse page and limit from strings', () => {
      const result = getPagination({ page: '3', limit: '10' });
      expect(result).toEqual({ page: 3, limit: 10, skip: 20 });
    });

    it('should clamp page to minimum 1', () => {
      const result = getPagination({ page: '0' });
      expect(result.page).toBe(1);
      expect(result.skip).toBe(0);
    });

    it('should clamp limit to max 100', () => {
      const result = getPagination({ limit: '500' });
      expect(result.limit).toBe(100);
    });

    it('should clamp limit to min 1', () => {
      const result = getPagination({ limit: '-5' });
      expect(result.limit).toBe(1);
    });
  });

  // ─── buildPaginationMeta ────────────────────────────────────────
  describe('buildPaginationMeta', () => {
    it('should compute totalPages correctly', () => {
      expect(buildPaginationMeta(1, 10, 55)).toEqual({
        page: 1,
        limit: 10,
        total: 55,
        totalPages: 6,
      });
    });

    it('should handle zero total', () => {
      expect(buildPaginationMeta(1, 20, 0)).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('should handle exact division', () => {
      expect(buildPaginationMeta(1, 10, 30).totalPages).toBe(3);
    });
  });
});
