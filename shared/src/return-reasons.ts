/**
 * Dashboard spec §5.2: a return is given one of these reasons, picked from a
 * dropdown. There is no free-text option on purpose: a reason nobody can count
 * cannot tell the owner that one style keeps coming back for its size.
 *
 * The codes match the `ReturnReason` enum in `backend/prisma/schema.prisma`.
 * The labels live here, in `shared/`, because the POS dropdown, the dashboard
 * badges and the reports must all say the same thing for the same code.
 */
export const RETURN_REASONS = [
  { code: 'size_issue', label: 'Size issue' },
  { code: 'colour_mismatch', label: 'Colour mismatch' },
  { code: 'defect_damage', label: 'Defect / damage' },
  { code: 'changed_mind', label: 'Customer changed mind' },
  { code: 'wrong_item', label: 'Wrong item billed' },
  { code: 'not_as_expected', label: 'Not as expected' },
] as const;

export type ReturnReasonCode = (typeof RETURN_REASONS)[number]['code'];

export const RETURN_REASON_CODES: readonly ReturnReasonCode[] = RETURN_REASONS.map((r) => r.code);

export function isReturnReasonCode(value: unknown): value is ReturnReasonCode {
  return typeof value === 'string' && (RETURN_REASON_CODES as readonly string[]).includes(value);
}

/** The label for a code, or null for a legacy row that was never coded. */
export function returnReasonLabel(code: string | null | undefined): string | null {
  return RETURN_REASONS.find((r) => r.code === code)?.label ?? null;
}
