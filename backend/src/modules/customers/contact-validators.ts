import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler';

/**
 * Customer contact fields, defined in ONE place.
 *
 * Several screens write the same `Customer` row: the customers module's own
 * create/edit form, the POS quick-add dialog, the mobile POS capture screen,
 * and the bill's "correct customer details" page. They must agree on what a
 * valid phone or email is, or a number one screen refuses could sneak in
 * through another. `frontend/src/app/shared/validation/phone.ts` mirrors the
 * phone rule for the forms; this file is the authority.
 *
 * Contact details only. Nothing here touches money.
 */

/** Indian mobile numbers are exactly this many digits. */
export const PHONE_DIGITS = 10;

export const PHONE_MESSAGE = 'Enter a valid 10 digit mobile number';

/** The number stripped of spaces, dashes, brackets and any country prefix marks. */
export function phoneDigits(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Exactly 10 digits once the separators are ignored. Not 9, not 11, not 12. */
export function isValidPhone(value: string): boolean {
  return phoneDigits(value).length === PHONE_DIGITS;
}

/** What actually gets stored: the bare digits, so the unique index is honest. */
export function normalizePhone(value: string): string {
  return phoneDigits(value);
}

/**
 * A phone on an EXISTING customer only has to satisfy the 10 digit rule when
 * it is actually being changed.
 *
 * Live data predates the rule: some customers carry a country prefix, a
 * landline, or plain junk. A cashier who opens one of those to fix a spelling
 * must still be able to save, so an untouched number is kept exactly as it was
 * rather than being rejected or quietly rewritten. Touch it and it has to be
 * right.
 *
 * Returns the value to write.
 */
export function resolvePhoneChange(submitted: string, stored: string | null): string {
  const value = (submitted ?? '').trim();
  if (stored != null && phoneDigits(value) === phoneDigits(stored)) {
    return stored;
  }
  if (!isValidPhone(value)) {
    throw new AppError(PHONE_MESSAGE, 400);
  }
  return normalizePhone(value);
}

/**
 * Strict: for a phone being created. The `validate` middleware only checks the
 * body, it does not write a parsed value back, so the services call
 * `normalizePhone` themselves before storing.
 */
export const customerPhoneSchema = z.string().trim().refine(isValidPhone, PHONE_MESSAGE);

/**
 * Loose: for the body of an UPDATE, where the submitted value may be a legacy
 * number being carried through untouched. `resolvePhoneChange` in the service
 * is what enforces the rule there, because only the service knows what is
 * already stored.
 */
export const storedPhoneSchema = z.string().trim().min(1, 'Phone is required').max(30);

// Cleared inputs send null, and Zod's .optional() alone rejects null.
export const customerEmailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address')
  .max(120, 'Email address is too long')
  .optional()
  .nullable();

export const customerAddressSchema = z
  .string()
  .trim()
  .max(500, 'Address is too long')
  .optional()
  .nullable();
