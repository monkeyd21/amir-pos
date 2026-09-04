import { z } from 'zod';

/**
 * Customer contact fields, defined in ONE place.
 *
 * Two screens write the same `Customer` row: the customers module's own
 * create/edit form, and the bill's "correct customer details" page in the sales
 * module. They must agree on what a valid phone or email is, or a number the
 * create form refuses could sneak in through the bill.
 *
 * Contact details only. Nothing here touches money.
 */

// At least 10 digits, and nothing but digits and the usual separators, so
// "98765 43210", "+91 98765-43210" and "(022) 1234 5678" all pass while
// "not-a-phone" and a 6-digit stub do not. One regex rather than a chain of
// checks, so a bad number gets one clear message instead of a pile of them.
export const customerPhoneSchema = z
  .string()
  .trim()
  .regex(
    /^(?=(?:\D*\d){10})[0-9+\-\s()]{10,20}$/,
    'Enter a valid phone number with at least 10 digits'
  );

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
