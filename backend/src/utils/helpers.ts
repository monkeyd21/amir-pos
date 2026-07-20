import crypto from 'crypto';
import prisma from '../config/database';

/**
 * Generate a unique sale/return number
 */
export const generateNumber = (prefix: string): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Join a person's name, tolerating a missing last name (customers may have
 * only a first name — last name is optional).
 */
export const fullName = (p: { firstName: string; lastName?: string | null }): string =>
  `${p.firstName} ${p.lastName ?? ''}`.trim();

// First 9-digit number; the sequence runs 100000001, 100000002, …
const BARCODE_BASE = 100000000;

/**
 * Reserve `count` sequential 9-digit NUMERIC barcodes (printed as Code128 — NOT
 * EAN-13). Reads the current max 9-digit numeric barcode and hands out the next
 * ones; legacy non-numeric barcodes (e.g. "SE05658") are ignored and left as-is.
 * Code128 carries its own mod-103 checksum, so no data-level check digit is needed.
 *
 * Reserve ALL of a batch's barcodes up front (one call) — within a transaction
 * the just-inserted rows aren't visible to the MAX query, so per-row calls would
 * collide.
 */
export const nextBarcodes = async (count: number): Promise<string[]> => {
  if (count <= 0) return [];
  const rows = await prisma.$queryRawUnsafe<{ m: bigint | null }[]>(
    `SELECT MAX(barcode::bigint) AS m FROM product_variants WHERE barcode ~ '^[0-9]{9}$'`
  );
  const start = Number(rows[0]?.m ?? BARCODE_BASE) || BARCODE_BASE;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(String(start + i));
  return out;
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

/** Whole days elapsed between two dates (floored). */
export const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

/**
 * §1.5 — is a sale still inside its return/exchange policy window?
 * `windowDays` is inclusive (a sale `windowDays` old still qualifies).
 */
export const isWithinPolicyWindow = (
  saleDate: Date,
  windowDays: number,
  now: Date = new Date()
): boolean => daysBetween(saleDate, now) <= windowDays;

/**
 * §3.4 — payment state of a bill, which drives the edit lock:
 *   unpaid  → full edit allowed
 *   partial → edit locked (needs supervisor PIN to void the partial first)
 *   paid    → no edit (return/exchange only)
 */
export type BillPaymentStatus = 'unpaid' | 'partial' | 'paid';
export const billPaymentStatus = (paid: number, total: number): BillPaymentStatus => {
  if (paid <= 0.001) return 'unpaid';
  if (paid + 0.001 >= total) return 'paid';
  return 'partial';
};
