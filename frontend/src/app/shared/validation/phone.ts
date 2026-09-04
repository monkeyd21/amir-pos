/**
 * The mobile number rule, in one place for every screen that captures or
 * corrects one: the customers form, the POS quick-add dialog, the mobile POS
 * capture screen and the bill's customer correction page.
 *
 * This mirrors `backend/src/modules/customers/contact-validators.ts`, which is
 * the authority. The server enforces the same rule, so a client that skips
 * this still cannot save a bad number; this exists to fail on the counter
 * instead of after a round trip.
 */

/** Indian mobile numbers are exactly this many digits. */
export const PHONE_DIGITS = 10;

export const PHONE_MESSAGE = 'Enter a valid 10 digit mobile number';

/** The number stripped of spaces, dashes, brackets and country prefix marks. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Exactly 10 digits once the separators are ignored. Not 9, not 11, not 12. */
export function isValidPhone(value: string | null | undefined): boolean {
  return phoneDigits(value).length === PHONE_DIGITS;
}

/** What actually gets stored: the bare digits, so the unique index is honest. */
export function normalizePhone(value: string | null | undefined): string {
  return phoneDigits(value);
}

/**
 * What an input event is allowed to leave in the field: digits only, and it
 * stops at 10 so the cashier cannot type an 11th.
 */
export function sanitizePhoneInput(value: string | null | undefined): string {
  return phoneDigits(value).slice(0, PHONE_DIGITS);
}

/**
 * The message to show under a phone field, or null when there is nothing to
 * complain about.
 *
 * `original` is the number the record was loaded with. Customers created
 * before this rule can carry a country prefix, a landline or junk, and someone
 * opening one of those to fix a spelling must still be able to save, so a
 * number that has not been touched is never flagged. Change it and it has to
 * be right. The server applies exactly the same exemption.
 *
 * An empty field is not flagged either: the disabled Save already says the
 * form is incomplete, and a red error before the cashier has typed anything
 * reads as a failure rather than a prompt.
 */
export function phoneFieldError(value: string, original?: string | null): string | null {
  const phone = (value ?? '').trim();
  if (!phone) return null;
  if (original != null && phoneDigits(phone) === phoneDigits(original)) return null;
  return isValidPhone(phone) ? null : PHONE_MESSAGE;
}
