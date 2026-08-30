/**
 * Env-aware view of the storefront assumptions.
 *
 * Defaults live in `shared/src/shop-config.ts`, where each one is tagged
 * CONFIRMED / ASSUMED / ESTIMATED. This module overlays environment variables
 * so production can be tuned without a rebuild, and resolves the two runtime
 * identities the shop needs (the branch it sells from, and the system user
 * online sales are attributed to).
 */
import {
  SHOP_IDENTITY,
  RESERVATION,
  COMMERCE,
  CUSTOMER_AUTH,
  DELIVERY,
  CATALOGUE,
} from '@clothing-erp/shared';

const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : v === 'true' || v === '1';

export const shopConfig = {
  identity: {
    ...SHOP_IDENTITY,
    whatsappNumber: process.env.SHOP_WHATSAPP_NUMBER || SHOP_IDENTITY.whatsappNumber,
    shopHost: process.env.SHOP_HOST || SHOP_IDENTITY.shopHost,
  },

  /**
   * ASSUMED — which branch fulfils web orders (PLAN.md Q1). Defaults to branch
   * 1, the single store. Set SHOP_BRANCH_ID to point the shop at a dedicated
   * online branch instead; nothing else needs to change.
   */
  branchId: num(process.env.SHOP_BRANCH_ID, 1),

  /**
   * `Sale.userId` is non-null, so an online sale needs an actor. This is the
   * seeded "Online Store" system user; see `shop/system-user.ts`, which creates
   * it on demand rather than depending on seed order.
   */
  systemUserEmail: process.env.SHOP_SYSTEM_USER_EMAIL || 'online@sabihasethnic.com',

  reservation: {
    cartHoldMinutes: num(process.env.SHOP_CART_HOLD_MINUTES, RESERVATION.cartHoldMinutes),
    checkoutHoldMinutes: num(process.env.SHOP_CHECKOUT_HOLD_MINUTES, RESERVATION.checkoutHoldMinutes),
    paymentGraceMinutes: num(process.env.SHOP_PAYMENT_GRACE_MINUTES, RESERVATION.paymentGraceMinutes),
    cartLifetimeDays: num(process.env.SHOP_CART_LIFETIME_DAYS, RESERVATION.cartLifetimeDays),
    sweeperIntervalMs: num(process.env.SHOP_SWEEPER_INTERVAL_MS, RESERVATION.sweeperIntervalMs),
  },

  commerce: {
    ...COMMERCE,
    freeDeliveryAbove: num(process.env.SHOP_FREE_DELIVERY_ABOVE, COMMERCE.freeDeliveryAbove),
    flatShippingFee: num(process.env.SHOP_FLAT_SHIPPING_FEE, COMMERCE.flatShippingFee),
    prepaidDiscountPercent: num(process.env.SHOP_PREPAID_DISCOUNT_PCT, COMMERCE.prepaidDiscountPercent),
    codEnabled: bool(process.env.SHOP_COD_ENABLED, COMMERCE.codEnabled),
    codMinOrderValue: num(process.env.SHOP_COD_MIN, COMMERCE.codMinOrderValue),
    codMaxOrderValue: num(process.env.SHOP_COD_MAX, COMMERCE.codMaxOrderValue),
    codFee: num(process.env.SHOP_COD_FEE, COMMERCE.codFee),
    commissionOnOnlineSales: bool(
      process.env.SHOP_COMMISSION_ON_ONLINE,
      COMMERCE.commissionOnOnlineSales
    ),
    loyaltyRedeemableOnline: bool(
      process.env.SHOP_LOYALTY_ONLINE,
      COMMERCE.loyaltyRedeemableOnline
    ),
  },

  auth: {
    ...CUSTOMER_AUTH,
    otpTtlMinutes: num(process.env.SHOP_OTP_TTL_MINUTES, CUSTOMER_AUTH.otpTtlMinutes),
    otpMaxAttempts: num(process.env.SHOP_OTP_MAX_ATTEMPTS, CUSTOMER_AUTH.otpMaxAttempts),
    otpRequestsPerHour: num(process.env.SHOP_OTP_PER_HOUR, CUSTOMER_AUTH.otpRequestsPerHour),
    refreshTokenTtlDays: num(process.env.SHOP_REFRESH_TTL_DAYS, CUSTOMER_AUTH.refreshTokenTtlDays),
    /** Separate secret from staff JWTs: different audience, different blast radius. */
    jwtSecret:
      process.env.SHOP_JWT_SECRET || process.env.JWT_SECRET || 'change-me-shop',
    /**
     * ASSUMED — in development the OTP is returned in the API response and
     * logged, so the flow is testable without a WhatsApp number. NEVER true in
     * production; the code refuses to enable it when NODE_ENV=production.
     */
    devEchoOtp:
      process.env.NODE_ENV !== 'production' &&
      bool(process.env.SHOP_DEV_ECHO_OTP, true),
  },

  delivery: {
    ...DELIVERY,
    dispatchDays: num(process.env.SHOP_DISPATCH_DAYS, DELIVERY.dispatchDays),
    deliveryDaysMin: num(process.env.SHOP_DELIVERY_DAYS_MIN, DELIVERY.deliveryDaysMin),
    deliveryDaysMax: num(process.env.SHOP_DELIVERY_DAYS_MAX, DELIVERY.deliveryDaysMax),
    servicablePincodePrefixes: (process.env.SHOP_PINCODE_PREFIXES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  catalogue: {
    ...CATALOGUE,
    pageSize: num(process.env.SHOP_PAGE_SIZE, CATALOGUE.pageSize),
    hideProductsWithoutImages: bool(
      process.env.SHOP_HIDE_IMAGELESS,
      CATALOGUE.hideProductsWithoutImages
    ),
  },
} as const;

export type ShopConfig = typeof shopConfig;
