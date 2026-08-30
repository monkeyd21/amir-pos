# Assumptions made while building v1

Everything below was a guess. Each one is **parametrised**, so changing it is a
config edit rather than a code change.

**Single source of truth:** [`shared/src/shop-config.ts`](../../shared/src/shop-config.ts).
Each entry there is tagged `CONFIRMED` / `ASSUMED` / `ESTIMATED`, and
[`backend/src/config/shop.ts`](../../backend/src/config/shop.ts) overlays
environment variables so production can be tuned without a rebuild.

`GET /api/shop/v1/config` returns the live values, so the site can never
disagree with the server about its own rules.

---

## The two worth arguing with first

### 1. Free delivery on everything

`flatShippingFee: 0`, `freeDeliveryAbove: 0`.

Not laziness. A `Sale` in this ERP records a supply of **goods**: its total is
derived from its line items, and `Payment` rows are expected to sum to that
total. There is nowhere to put a shipping charge without either inventing a
phantom line item or leaving the sale looking overpaid.

So charging for delivery needs an accounting decision first — a service SKU? a
separate income account? — which is **Q2** in the plan. Until then free delivery
is both simpler and honest, and it matches the reference site, which advertises
"Free Shipping On All Orders".

The shipping fields are wired through the quote and `ShopOrder` regardless, so
switching this on later is a config change plus that one decision.

### 2. Prepaid only — COD is off

`codEnabled: false`.

The plumbing is complete end to end: `ShopPaymentMode`, the per-product
`codBlocked` gate, the quote branch, the order branch. The flag is off because
one question is genuinely unresolved:

> **When does a COD order become a `Sale`?**

The money arrives days later, at the door, with no POS session and no cashier to
attribute the cash to. Booking it at despatch overstates collected cash; booking
it at delivery leaves stock gone with no sale behind it. That is a business
decision, not a coding one. Set `SHOP_COD_ENABLED=true` once it is made.

---

## Everything else

| Assumption | Value | Env var | Notes |
|---|---|---|---|
| Fulfilling branch | `1` | `SHOP_BRANCH_ID` | PLAN.md Q1. Point at a dedicated online branch if you'd rather. |
| Cart hold | 15 min | `SHOP_CART_HOLD_MINUTES` | Q4. Long enough to browse, short enough not to hide stock from the counter. |
| Checkout hold | 20 min | `SHOP_CHECKOUT_HOLD_MINUTES` | Extended when checkout starts. |
| Payment grace | 30 min | `SHOP_PAYMENT_GRACE_MINUTES` | Holds outlast the payment window so a slow gateway can't strand a shopper. |
| Prepaid discount | 5% | `SHOP_PREPAID_DISCOUNT_PCT` | Matches the reference site's incentive. |
| Headline discount | 10% | — | The ERP already sets sale price at MRP − 10%, so this is a real number, not marketing. Q11 asks whether you want deeper. |
| Commission on online sales | none | `SHOP_COMMISSION_ON_ONLINE` | Q5. No agent served the sale. |
| Loyalty redeemable online | yes | `SHOP_LOYALTY_ONLINE` | Q6. OTP-verified shoppers only; same minimum-balance rule as the counter. |
| OTP channel | WhatsApp | — | Reuses the Graph API integration already in the ERP. |
| OTP length / TTL | 6 digits, 10 min | `SHOP_OTP_TTL_MINUTES` | 5 attempts, 5 requests an hour. |
| Shopper session | 30 min access, 30 day refresh | `SHOP_REFRESH_TTL_DAYS` | Separate secret from staff JWTs; refresh tokens rotate on use. |
| Dispatch time | 2 days | `SHOP_DISPATCH_DAYS` | ESTIMATED. |
| Delivery window | 3–7 days | `SHOP_DELIVERY_DAYS_*` | ESTIMATED. |
| Serviceable pincodes | all valid Indian | `SHOP_PINCODE_PREFIXES` | Empty list = deliver everywhere. |
| Products per page | 24 | `SHOP_PAGE_SIZE` | |
| Hide products without images | yes | `SHOP_HIDE_IMAGELESS` | A grey placeholder grid sells nothing. |
| Navigation | Girls/Boys first, then category | — | Q15. |
| Domain | `shop.` subdomain | `SHOP_HOST` | Q7. ERP stays on `erp.`. |

## Placeholder content that must be replaced

| What | Where | Why |
|---|---|---|
| **Chest and length per size** | `SHOP_SIZES` in `shop-config.ts`, and the seed in the migration | The supplied chart gave age → size only. Chest follows the convention that the size number is the chest in inches; **the lengths are my estimates**. PLAN.md **Q13**. |
| WhatsApp number | `SHOP_IDENTITY.whatsappNumber` | Placeholder `919999999999`. |
| Shop address | `SHOP_IDENTITY.addressLine` | Verify before launch. |
| Policy pages | `storefront/src/app/policies/[slug]/page.tsx` | Delivery, exchanges, refunds, privacy, terms — written plainly, but they need a read-through by the shop. |
| Demo catalogue | `backend/prisma/seed-shop-demo.ts` | Development only. Never run against production. |

## Known gaps

- **No refund API.** The gateway driver in this repo exposes `createQRPayment`,
  `getPaymentStatus` and `verifyWebhook` — no refund call. When an order fails
  the stock re-check after payment, the obligation is logged as an error *and*
  recorded as a `MessageLog` row so it is visible in the ERP, but a human must
  issue the refund from the Cashfree dashboard. Wiring a real refund endpoint is
  the highest-value next task.
- **Order fulfilment UI.** Orders can be placed, paid and read back over the
  API, but there is no screen in the Angular admin yet for pick/pack/ship. That
  is Phase 6.
- **Object storage for images.** `ProductImage.url` is stored and served as-is.
  The bulk upload tool and CDN wiring are Phase 1 leftovers.
- **Size exchange flow.** The `Return` machinery exists; the customer-facing
  path into it does not. PLAN.md Q16 — likely the main support flow for
  kidswear.
