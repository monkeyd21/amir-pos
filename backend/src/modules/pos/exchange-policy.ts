/**
 * The return/exchange rules now live in `@clothing-erp/shared` so the POS and
 * Sales screens apply the exact same test the server does — see the doc comment
 * there for the policy itself. This module stays as the backend's import site so
 * every existing `../pos/exchange-policy` import keeps working.
 */
export {
  canExchangeLine,
  refundRule,
  canRefundLine,
  clearanceCashOutBlocked,
} from '@clothing-erp/shared';
export type { ExchangeLinePolicy, RefundRule } from '@clothing-erp/shared';
