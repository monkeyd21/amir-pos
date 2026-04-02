import crypto from 'crypto';

/**
 * Generate a unique sale/return number
 */
export const generateNumber = (prefix: string): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Generate EAN-13 barcode with check digit
 */
export const generateEAN13 = (prefix: string = '200'): string => {
  const digits = prefix + Math.floor(Math.random() * 10 ** (12 - prefix.length))
    .toString()
    .padStart(12 - prefix.length, '0');

  // Calculate check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;

  return digits + checkDigit;
};

/**
 * Generate SKU from product attributes
 */
export const generateSKU = (brand: string, name: string, size: string, color: string): string => {
  const b = brand.substring(0, 3).toUpperCase();
  const n = name.substring(0, 3).toUpperCase();
  const s = size.toUpperCase();
  const c = color.substring(0, 3).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${b}-${n}-${s}-${c}-${rand}`;
};

/**
 * Slugify a string
 */
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Paginate query params
 */
export const getPagination = (query: { page?: string; limit?: string }) => {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Build pagination meta
 */
export const buildPaginationMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
