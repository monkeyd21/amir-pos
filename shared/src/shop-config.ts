/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  STOREFRONT ASSUMPTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Every guess made while building v1 of the online store lives here, in one
 *  file, so it can be reviewed and changed without hunting through code.
 *
 *  Each entry is tagged:
 *
 *    CONFIRMED  — taken from the ERP, the supplied size chart, or existing code.
 *    ASSUMED    — my guess. Change it. Nothing depends on it being right.
 *    ESTIMATED  — a real number is needed before launch; mine is a placeholder.
 *
 *  Anything that could reasonably differ per environment also reads an env var,
 *  so production can be tuned without a rebuild. See `backend/src/config/shop.ts`
 *  for the env-aware wrapper.
 *
 *  Tracking doc: docs/ecommerce/PLAN.md   ·   Spec: docs/ecommerce/tech-spec.html
 */

// ─── Identity ────────────────────────────────────────────────────────────────

export const SHOP_IDENTITY = {
  /** CONFIRMED — from branches.receiptHeader / CLAUDE.md. */
  name: "Sabiha's Ethnic",
  /** ASSUMED — short descriptor under the logo. */
  tagline: 'Kidswear · Nagpur',
  /** ASSUMED — used in page titles and structured data. */
  legalName: "Sabiha's Ethnic",
  /** ESTIMATED — replace with the real shop address. */
  addressLine: 'Dharampeth Road, Nagpur 440010',
  /** ASSUMED — shown in the footer. */
  openingHours: 'Open 11am – 9pm, closed Tuesdays',
  /** ESTIMATED — replace with the real WhatsApp business number (E.164, no +). */
  whatsappNumber: '919999999999',
  /** CONFIRMED — the APK already points at this host (frontend/src/environments/api-url.ts). */
  erpHost: 'erp.sabihasethnic.com',
  /** ASSUMED — Q7 in PLAN.md is still open; subdomain chosen over apex. */
  shopHost: 'shop.sabihasethnic.com',
} as const;

// ─── Sizes ───────────────────────────────────────────────────────────────────

/**
 * CONFIRMED (age → size) — from the supplied Kids Ethnic Wear size chart.
 * ESTIMATED (chest, length) — chest follows the Indian kidswear convention that
 * the size number is the chest in inches; lengths are my placeholders and MUST
 * be replaced with the shop's measurements before launch. PLAN.md Q13.
 */
export interface ShopSize {
  /** The size as printed on the tag and barcode label. */
  name: string;
  /** Human age label shown beside the number everywhere in the storefront. */
  ageLabel: string;
  /** Ordering on size selectors and in the size guide. */
  sortOrder: number;
  /** Garment chest, inches. CONFIRMED by convention (size number = chest). */
  chestInches: number;
  /** Garment length, inches. ESTIMATED — needs real figures. */
  lengthInches: number;
  /** Lower bound of the age band in months, for the shop-by-age filter. */
  ageFromMonths: number;
  /** Upper bound of the age band in months, inclusive. */
  ageToMonths: number;
}

export const SHOP_SIZES: ShopSize[] = [
  { name: '12', ageLabel: '6 months',    sortOrder: 10, chestInches: 12, lengthInches: 17, ageFromMonths: 6,   ageToMonths: 8 },
  { name: '14', ageLabel: '9 months',    sortOrder: 20, chestInches: 14, lengthInches: 19, ageFromMonths: 9,   ageToMonths: 11 },
  { name: '16', ageLabel: '1 year',      sortOrder: 30, chestInches: 16, lengthInches: 21, ageFromMonths: 12,  ageToMonths: 23 },
  { name: '18', ageLabel: '2 years',     sortOrder: 40, chestInches: 18, lengthInches: 24, ageFromMonths: 24,  ageToMonths: 35 },
  { name: '20', ageLabel: '3 years',     sortOrder: 50, chestInches: 20, lengthInches: 26, ageFromMonths: 36,  ageToMonths: 47 },
  { name: '22', ageLabel: '4 years',     sortOrder: 60, chestInches: 22, lengthInches: 28, ageFromMonths: 48,  ageToMonths: 59 },
  { name: '24', ageLabel: '5 years',     sortOrder: 70, chestInches: 24, lengthInches: 30, ageFromMonths: 60,  ageToMonths: 71 },
  { name: '26', ageLabel: '6 years',     sortOrder: 80, chestInches: 26, lengthInches: 32, ageFromMonths: 72,  ageToMonths: 83 },
  { name: '28', ageLabel: '7–8 years',   sortOrder: 90, chestInches: 28, lengthInches: 34, ageFromMonths: 84,  ageToMonths: 107 },
  { name: '30', ageLabel: '9–10 years',  sortOrder: 100, chestInches: 30, lengthInches: 37, ageFromMonths: 108, ageToMonths: 131 },
  { name: '32', ageLabel: '11–12 years', sortOrder: 110, chestInches: 32, lengthInches: 40, ageFromMonths: 132, ageToMonths: 155 },
  { name: '34', ageLabel: '13–14 years', sortOrder: 120, chestInches: 34, lengthInches: 43, ageFromMonths: 156, ageToMonths: 179 },
  { name: '36', ageLabel: '15–16 years', sortOrder: 130, chestInches: 36, lengthInches: 45, ageFromMonths: 180, ageToMonths: 203 },
];

/** Look up a size's age label. Falls back to the bare name for unknown sizes. */
export function ageLabelForSize(sizeName: string): string {
  return SHOP_SIZES.find((s) => s.name === sizeName)?.ageLabel ?? '';
}

/**
 * ASSUMED — the age bands offered as "shop by age" tiles on the home page and
 * as a listing filter. Parents arrive knowing an age, not a size.
 */
export const AGE_BANDS = [
  { slug: '0-1',   label: '0 – 1 yr',    sizes: ['12', '14', '16'] },
  { slug: '2-3',   label: '2 – 3 yrs',   sizes: ['18', '20'] },
  { slug: '4-5',   label: '4 – 5 yrs',   sizes: ['22', '24'] },
  { slug: '6-8',   label: '6 – 8 yrs',   sizes: ['26', '28'] },
  { slug: '9-10',  label: '9 – 10 yrs',  sizes: ['30'] },
  { slug: '11-12', label: '11 – 12 yrs', sizes: ['32'] },
  { slug: '13-16', label: '13 – 16 yrs', sizes: ['34', '36'] },
] as const;

// ─── Reservations ────────────────────────────────────────────────────────────

export const RESERVATION = {
  /** ASSUMED — PLAN.md Q4. Long enough to browse, short enough not to hide stock. */
  cartHoldMinutes: 15,
  /** ASSUMED — extended when the shopper enters checkout. */
  checkoutHoldMinutes: 20,
  /**
   * ASSUMED — how long after payment confirmation a hold stays consumable.
   * Guards against a webhook arriving after the hold would otherwise lapse.
   */
  paymentGraceMinutes: 30,
  /** ASSUMED — an anonymous cart is forgotten after this long. */
  cartLifetimeDays: 30,
  /** ASSUMED — sweeper cadence. Correctness does not depend on it (lazy expiry). */
  sweeperIntervalMs: 5 * 60 * 1000,
} as const;

// ─── Commerce ────────────────────────────────────────────────────────────────

export const COMMERCE = {
  /**
   * ASSUMED — free delivery on ALL orders in v1, matching the reference site
   * ("Free Shipping On All Orders").
   *
   * This is not laziness, it is what keeps the ledger correct. A `Sale` in this
   * ERP records a supply of GOODS: its total is derived from its line items, and
   * `Payment` rows are expected to sum to that total. There is nowhere to put a
   * shipping charge without either inventing a phantom line item or leaving the
   * sale looking overpaid. Charging for delivery therefore needs a decision on
   * how the fee is booked (a service SKU? a separate income account?) — see
   * PLAN.md Q2 — and until then, free delivery is both simpler and honest.
   *
   * The fields below stay wired through the quote and `ShopOrder` so turning
   * this on later is a config change plus that one accounting decision.
   */
  freeDeliveryAbove: 0,
  /** ASSUMED — 0 means free delivery on everything. See above before raising it. */
  flatShippingFee: 0,
  /**
   * ASSUMED — PLAN.md Q2. If shipping is ever charged, it is a composite supply
   * taxed at the rate of the principal supply. Unused while the fee is 0.
   */
  shippingTaxed: true,
  /** ASSUMED — matches the reference site's prepaid incentive. */
  prepaidDiscountPercent: 5,
  /**
   * ASSUMED — v1 ships PREPAID ONLY (PLAN.md Q10).
   *
   * The schema, the quote and the order model all carry COD end to end, but the
   * flag is off because one question is genuinely unresolved: when does a COD
   * order become a `Sale`? The money arrives days later, at the door, with no
   * POS session and no cashier to attribute the cash to. Booking it at
   * despatch overstates collected cash; booking it at delivery leaves stock
   * gone with no sale behind it.
   *
   * That is a business decision, not a coding one. Set SHOP_COD_ENABLED=true
   * once it is made, and see `orders.ts` for where the branch goes.
   */
  codEnabled: false,
  /** ASSUMED — orders below this are prepaid-only, to limit refusal losses. */
  codMinOrderValue: 500,
  /** ASSUMED — orders above this are prepaid-only, to limit exposure. */
  codMaxOrderValue: 10000,
  /** ASSUMED — extra fee on COD orders, offsetting refusal cost.0 disables it. */
  codFee: 0,
  /**
   * ASSUMED — the master switch for taking money.
   *
   * FALSE by default, deliberately. A storefront can be genuinely useful while
   * browse-only: real catalogue, real live stock, real size guide — which is
   * what lets the shop opt products in and photograph them against something
   * real. What it must NOT do is accept an order it cannot collect on or fulfil.
   *
   * Turn this on (SHOP_CHECKOUT_ENABLED=true) only when all three are true:
   *   1. PAYMENT_PROVIDER=cashfree with production credentials
   *   2. WHATSAPP_ACCESS_TOKEN set, so sign-in OTPs can actually be delivered
   *   3. enough photographed, onlineVisible products to be worth buying from
   */
  checkoutEnabled: false,

  /** CONFIRMED — the ERP already runs a 7-day exchange window (branches.returnPolicy). */
  exchangeWindowDays: 7,
  /** ASSUMED — Q11. The ERP already prices sale = MRP − 10%, so this is honest. */
  headlineDiscountPercent: 10,
  /** CONFIRMED — utils/tax.ts. GST is 5% at or below this per-unit value, 18% above. */
  gstThreshold: 2500,
  /** ASSUMED — online sales earn no staff commission (PLAN.md Q5). */
  commissionOnOnlineSales: false,
  /** ASSUMED — loyalty points can be redeemed online by an OTP-verified customer (Q6). */
  loyaltyRedeemableOnline: true,
} as const;

// ─── Catalogue ───────────────────────────────────────────────────────────────

/**
 * CONFIRMED — the category names come from `backend/src/utils/tax.ts`, which
 * routes HSN codes by category for this exact catalogue.
 */
export const CATEGORY_HSN = {
  DRESS: '6211',
  CORDSET: '6204',
  FROCK: '6204',
  'ONE PIECE': '6204',
} as const;

/** ASSUMED — top-level navigation. PLAN.md Q15 (girls/boys first vs category first). */
export const NAV = [
  { label: 'New in', href: '/c/new-in' },
  { label: 'Girls', href: '/c/girls' },
  { label: 'Boys', href: '/c/boys' },
  { label: 'Festive', href: '/c/festive' },
  { label: 'Shop by age', href: '/age' },
  { label: 'Size guide', href: '/size-guide' },
  { label: 'Sale', href: '/c/sale', accent: true },
] as const;

// ─── Customer auth ───────────────────────────────────────────────────────────

export const CUSTOMER_AUTH = {
  /** ASSUMED — OTP length. */
  otpLength: 6,
  /** ASSUMED — how long a code stays valid. */
  otpTtlMinutes: 10,
  /** ASSUMED — wrong-code attempts before the code is burned. */
  otpMaxAttempts: 5,
  /** ASSUMED — codes requested per phone per hour. */
  otpRequestsPerHour: 5,
  /** ASSUMED — short-lived access token for shoppers. */
  accessTokenTtl: '30m',
  /** ASSUMED — a shopper stays signed in for a month. */
  refreshTokenTtlDays: 30,
  /** ASSUMED — WhatsApp is the OTP channel; the ERP already has the Graph API wired. */
  otpChannel: 'whatsapp' as 'whatsapp' | 'sms',
} as const;

// ─── Delivery ────────────────────────────────────────────────────────────────

export const DELIVERY = {
  /** ESTIMATED — replace with the courier's real serviceability data. */
  dispatchDays: 2,
  /** ESTIMATED — quoted delivery window shown to the shopper. */
  deliveryDaysMin: 3,
  /** ESTIMATED — as above. */
  deliveryDaysMax: 7,
  /**
   * ASSUMED — pincode serviceability. An empty allow-list means "serve every
   * valid 6-digit Indian pincode"; add prefixes to restrict.
   */
  servicablePincodePrefixes: [] as string[],
  /** CONFIRMED — the shop dispatches from Nagpur. */
  originCity: 'Nagpur',
} as const;

// ─── Catalogue presentation ──────────────────────────────────────────────────

export const CATALOGUE = {
  /** ASSUMED — products per listing page. */
  pageSize: 24,
  /** ASSUMED — cards on the home page's "new this week" grid. */
  homeNewInCount: 8,
  /** ASSUMED — related products on a product page. */
  relatedCount: 4,
  /** ASSUMED — a product with no image is hidden from the storefront entirely. */
  hideProductsWithoutImages: true,
  /** ASSUMED — how many days count as "new". */
  newInDays: 21,
} as const;

/** Every assumption group, for the /debug/assumptions endpoint and the docs. */
export const SHOP_CONFIG = {
  identity: SHOP_IDENTITY,
  sizes: SHOP_SIZES,
  ageBands: AGE_BANDS,
  reservation: RESERVATION,
  commerce: COMMERCE,
  customerAuth: CUSTOMER_AUTH,
  delivery: DELIVERY,
  catalogue: CATALOGUE,
  nav: NAV,
} as const;
