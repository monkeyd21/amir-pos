import { isReturnReasonCode, returnReasonLabel, ReturnReasonCode } from '@clothing-erp/shared';
import { AppError } from '../../middleware/errorHandler';

/**
 * Dashboard spec §5.2: every return carries one of the fixed reason codes.
 *
 * Clients send `reasonCode`. Older clients sent the code in `reason`, so a
 * `reason` that is itself a valid code is accepted as one. Free text is not a
 * reason any more: a refund without a code is refused, and an exchange without
 * one is recorded uncoded (the swap itself is the point; the dropdown is
 * offered, not forced).
 *
 * `reason` keeps the human label so receipts and old screens that print it go
 * on reading naturally.
 */
export function resolveReturnReason(
  input: { reasonCode?: string | null; reason?: string | null },
  opts: { required: boolean; fallbackText?: string }
): { reasonCode: ReturnReasonCode | null; reason: string | null } {
  const code = isReturnReasonCode(input.reasonCode)
    ? input.reasonCode
    : isReturnReasonCode(input.reason)
    ? input.reason
    : null;

  if (input.reasonCode != null && input.reasonCode !== '' && !isReturnReasonCode(input.reasonCode)) {
    throw new AppError(`Unknown return reason "${input.reasonCode}"`, 400);
  }
  if (!code && opts.required) {
    throw new AppError('Pick a return reason from the list', 400);
  }
  return {
    reasonCode: code,
    reason: code ? returnReasonLabel(code) : opts.fallbackText ?? null,
  };
}
