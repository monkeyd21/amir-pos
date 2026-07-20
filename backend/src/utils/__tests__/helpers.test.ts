import { generateSKU, slugify, getPagination, buildPaginationMeta, isWithinPolicyWindow, billPaymentStatus } from '../helpers';

describe('§3.4 billPaymentStatus (edit lock)', () => {
  it('unpaid when nothing is paid', () => {
    expect(billPaymentStatus(0, 1000)).toBe('unpaid');
  });
  it('partial when some but not all is paid', () => {
    expect(billPaymentStatus(400, 1000)).toBe('partial');
  });
  it('paid when the full amount (or more) is covered', () => {
    expect(billPaymentStatus(1000, 1000)).toBe('paid');
    expect(billPaymentStatus(1200, 1000)).toBe('paid');
  });
});

describe('§1.5 isWithinPolicyWindow (return/exchange policy windows)', () => {
  const now = new Date('2026-06-30T12:00:00Z');
  it('allows a same-day refund within a 1-day window', () => {
    expect(isWithinPolicyWindow(new Date('2026-06-30T09:00:00Z'), 1, now)).toBe(true);
  });
  it('allows a refund exactly at the 1-day edge', () => {
    expect(isWithinPolicyWindow(new Date('2026-06-29T09:00:00Z'), 1, now)).toBe(true);
  });
  it('blocks a refund past the 1-day window', () => {
    expect(isWithinPolicyWindow(new Date('2026-06-28T09:00:00Z'), 1, now)).toBe(false);
  });
  it('allows an exchange within 15 days but not beyond', () => {
    expect(isWithinPolicyWindow(new Date('2026-06-16T09:00:00Z'), 15, now)).toBe(true);
    expect(isWithinPolicyWindow(new Date('2026-06-14T09:00:00Z'), 15, now)).toBe(false);
  });
});

describe('Utils / Helpers', () => {
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
