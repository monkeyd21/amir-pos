# POS Overhaul — Work Log

Multi-batch POS upgrade driven by the client requirements doc (June 2026).
All batches below are **DONE and deployed to prod**. See `pos-pending-items.md`
for what's left and `deploy-notes.md` for how to deploy.

## Batch 1 — quick wins
- **Bill numbering** — sequential `W-0001` / `O-0001` per channel. `Sale.channel` enum + `BillSequence` counter; prefixes configurable in Settings (`getSetting('billNumbering',{walkin,online,pad})`); POS channel toggle.
- **Customer last name optional** — `Customer.lastName String?`; `fullName()` helper in `backend/src/utils/helpers.ts`; guarded all `firstName+lastName` display sites.
- **Disable arrow keys / wheel** on discount / special-discount / redeem-points — `NoSpinDirective`.
- **Scan sounds** — `ScanSoundService` (Web Audio): valid / duplicate / invalid.
- **Payment identifier** (bank/account name) for card/UPI — `Payment.identifier`.
- **Hold-bill remarks** — `holdRemarks` → `notes`.

## Batch 2 — money correctness
- **Audit log** — `AuditLog` model + `recordAudit()` (`backend/src/services/audit.ts`) + `GET /api/v1/audit` (owner/manager) + frontend `/audit` page.
- **Refund amount fix** — `processReturn` refunds from `SaleItem.total` (net of every discount), not `effectiveUnitPrice`. Fixed the ₹2,780 over-refund.
- **Proportional refund** — splits cash/card/UPI by original tender shares; restores redeemed loyalty points; claws back earned points; stores `refundBreakup` etc. on `Return`. Manager-only method override (cashier → 403), audited.
- **Commission reversal** — `reconcileCommissionsForSale()` (`backend/src/services/commission-reconcile.ts`) from return + exchange paths; `calculateCommissions` nets out `returnedQuantity`.

## Batch 3a — gift vouchers
- `GiftVoucher` + `VoucherRedemption` models; `voucher` added to `PaymentMethod`.
- `modules/vouchers`: create / list / lookup / cancel; `redeemVouchers()` + `creditBackVouchers()` helpers; all audited.
- Checkout `vouchers[]` tender (capped, no cash back); re-credited on return.
- Frontend `/vouchers` management page + POS tender entry.

## Batch 3b — bill editing after creation
- `PUT /sales/:saleId/edit` (manager/owner, reason required) — `editSale`. Send desired final item set; repriced with the same engine as checkout; reconciles inventory / loyalty / commission.
- **Settle the difference**: price rise → collect exact diff via `settlementMethod` (or explicit tenders/vouchers); price drop → proportional refund as `refunded` Payment rows. Audited as `sale.edited`.
- Frontend "Edit Bill" → `/sales/:id/edit` `BillEditComponent`.

## Batch 4 — offline mode
- **Idempotency keystone**: `Sale.clientRef String? @unique`. Repeat checkout with the same key returns the existing sale (`idempotent:true`) — no duplicate bills on retry/sync.
- `offline:true` checkout: MRP − manual discount only, stock-tolerant, deterministic.
- `GET /pos/catalog` snapshot for offline caching.
- Frontend `core/services/offline.service.ts` (localStorage catalog cache + sale queue + `sync()` + connectivity); POS offline banner + auto-sync.
- App-shell **service worker** (`@angular/service-worker` + `ngsw-config.json`) for cold-offline reload (prod builds only).

## Follow-up fixes (post-batches)
- **Session logout** — access-token TTL was 15m (`.env` override) → **8h** (config default + prod `.env`). Hardened auth interceptor (ReplaySubject shared refresh).
- **Barcode print "template not found"** — `resolveProfileAndTemplate` auto-provisions a default `pdf`/`browser` printer profile when a branch has none.
- **Non-returnable / exchange-only** — `Product.nonReturnable` + `Product.exchangeOnly` + per-line `SaleItem.nonReturnable` (POS `do_not_disturb_on` toggle). Enforced in `processReturn`.
- **Loyalty config not saving** — `minRedeemPoints` was missing from the loyalty `updateConfig` validator+service (Zod stripped it). Added.
- **Loyalty min-balance retention** — only the excess `(balance − minRedeemPoints)` is redeemable; the minimum is always kept.
- **Payment-before-discount UI** — tenders store `received` and re-fit applied `amount` to the current bill (`reclampTenders()`), so Change Due updates when a discount is entered after tendering.
- **Exchange credit ignored discounts** — exchanges now credit `SaleItem.total ÷ quantity` (net of every discount), not MRP/effective. A ₹4k item at 10% off credits ₹3.6k, not ₹4k. Fixed in both exchange paths + the exchange-panel display + frontend `startExchange`.

## Gotchas
- **Migrations**: the shadow DB chokes on pre-existing drift (`20260508210000_add_held_transactions` duplicates an earlier table). Don't use `prisma migrate dev` — generate SQL via `prisma migrate diff`, exclude unrelated `DropIndex` drift, apply with `prisma db execute`, then `prisma migrate resolve --applied`. (`migrate deploy` on prod is fine — it doesn't use the shadow DB.)
- **ts-node-dev** often misses file changes (esp. `sales/service.ts`). If no restart line appears in the log, `fuser -k 3000/tcp` then relaunch `npm run dev`.
