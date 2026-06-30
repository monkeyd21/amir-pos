# Changes NEW — POS System Requirements v2.0

Tracking checklist for the **"Changes NEW"** tab of the requirements doc, audited against the local repo.

**Legend:** `[ ]` = not started / GAP or PARTIAL · `[~]` = BUILT but not yet tested · `[x]` = done **and** tested.
Each item tagged **BUILT** / **PARTIAL** / **GAP** with file evidence from the code audit (2026-06-30).

> Source: Google Doc "POS SYSTEM REQUIREMENTS — Clothing Retail v2.0" (Changes NEW tab).
> ⚠️ Doc text was truncated mid section **13.2** — re-check the doc for anything after "Automated Expense Tracking" (possible 13.3+, 14+).

---

## 1. Discount & Return Safety Controls — **CRITICAL**
- [x] 1.1 Disable arrow keys in Manual/Special Discount + Redeem Points — **DONE + E2E TESTED** (`NoSpinDirective`). `built-section1-7 §1.1` ✓ (ArrowUp leaves value unchanged).
- [x] 1.2 Flags printed & highlighted on physical bill — **DONE + E2E TESTED** (per-line `** NON-RETURNABLE` / `** EXCHANGE ONLY` marker + legend on thermal receipt `receipt-print.service.ts` and WhatsApp PDF `receipt-pdf.ts`; flags via `getReceiptData`). E2E: `changes-new.spec.ts §1.2` ✓.
- [x] 1.3 Block Non-Returnable / Exchange-Only from return/exchange — **DONE + E2E TESTED** (`sales/service.ts:369-372`). `built-section1-7 §1.3` ✓ (return of flagged line rejected via UI).
- [ ] 1.4 **[ADDED] VOID workflow** (same-day, supervisor PIN, status=`voided`, immediate inventory restore, GST reversed, no return txn) — **GAP** (only `void` enum + payment guard exist; no action/PIN/restore).
- [ ] 1.5 **[ADDED] RETURN workflow** — **PARTIAL** (returns + GSTR-1 credit-note trail + intact original bill done; **MISSING policy windows: refund 1 day / exchange 15 days**).

## 2. Payment Identification (UPI / Card) — **HIGH**
- [ ] 2.1 Settings: separate Card/UPI config sections + bank-account/gateway list — **GAP** (settings module only has commissionMode/billNumbering/messaging).
- [ ] 2.2 "Set as Default" account per mode, auto-populate at billing — **GAP** (depends on 2.1).
- [x] 2.3 Capture payment identifier per txn — **DONE + E2E TESTED** (`Payment.identifier`). `built-section1-7 §2.3` ✓ (card identifier entered in UI persists on the sale).
- [ ] 2.4 Cashier override default & pick another account per bill — **PARTIAL** (can enter free-text identifier per tender; no account dropdown to override — blocked by 2.1).
- [ ] 2.5 **[ADDED]** Lock payment interface until all discounts applied — **GAP** (`canCheckout` only checks cart/amount; no discount-applied gate).

## 3. Seamless Bill Editing (POS Integration) — **HIGH**
- [ ] 3.1 Bill editing **inside POS** (no Sales-tab redirect) — **GAP** (BillEditComponent only routed under `sales/:id/edit`; not reachable from POS).
- [~] 3.2 Retrieve/edit bill (add/remove/replace), auto-update inventory — **BUILT backend** (`editSale` `sales/service.ts:928-1297`, inventory delta 1019-1046) but only from Sales tab. Needs POS integration (3.1) + test.
- [~] 3.3 Recalc totals + payment adjustment without exiting POS — **BUILT logic** (`sales/service.ts:1070-1219`) but outside POS. Blocked by 3.1.
- [ ] 3.4 **[ADDED]** Edit + partial-payment lock (unpaid=edit / partial=void-payment+supervisor PIN / paid=no edit) — **GAP** (no bill-level payment-status calc, no supervisor PIN, no void-partial flow).

## 4. Hold Bill Functionality — **MEDIUM**
- [x] 4.1 Optional Remarks field on Hold — **DONE + E2E TESTED**. `built-section1-7 §4` ✓.
- [x] 4.2 Remarks visible when retrieving held bill — **DONE + E2E TESTED** (held card shows `held.notes`). `built-section1-7 §4` ✓.
- [ ] 4.3 **[ADDED]** Any cashier can retrieve (✓ built) + held items soft-reserved in inventory — **PARTIAL** (retrieval BUILT; **soft-reserve GAP** — no `onHold`/`reserved` inventory field).
- [ ] 4.4 **[ADDED]** Hold auto-expires 24h (configurable) + release inventory + archive — **GAP** (no `expiresAt`/`archivedAt`, no cleanup job).
- [ ] 4.5 **[ADDED]** EOD report of active holds (cashier, remarks, age) — **GAP** (daily summary excludes holds).

## 5. Streamlined Customer Creation — **HIGH**
- [x] 5.1 Auto New-Customer prompt on unrecognized phone — **DONE + E2E TESTED** (POS auto-opens add-customer dialog on a no-match 10-digit phone). `section5-customers` ✓.
- [x] 5.2 No mobile re-entry — auto-map searched number — **DONE + E2E TESTED** (dialog phone pre-filled from search). `section5-customers` ✓.
- [x] 5.3 Mandatory Mobile/First Name/**DOB**/**Gender (M/F)** — **DONE + E2E TESTED** (`Customer.dateOfBirth`+`gender` cols; dialog requires DOB+gender). `section5-customers` ✓.
- [x] 5.4 **[ADDED]** Legacy customers: prompt to update DOB + Gender — **DONE + E2E TESTED** (POS shows "Add date of birth & gender" when missing). `section5-customers` ✓.
- [x] 5.5 Existing-customer insights incl. **Birthday** — **DONE + E2E TESTED** (birthday line in POS customer card). `section5-customers` ✓.
- [x] 5.6 AI Phase 1 rule-based: preferred size + likely category = MODE(last 3), hide if <3 — **DONE + E2E TESTED** (`GET /customers/:id/suggestion`; POS suggestion panel). `section5-customers` ✓.
- [ ] 5.7 AI Phase 2 ML (post 500 txns) — **GAP** (deferred by design; do not block launch).

## 6. Gift Voucher — Issuance & Redemption — **ADDED / NEW**
- [x] 6.1a System-generated unique code (`GV-…`) — **DONE + E2E TESTED**. `built-section6-11 §6.1` ✓ (issue via UI → GV- card).
- [x] 6.1b Issued manually by manager — **DONE + E2E TESTED** (owner/manager create). `built-section6-11 §6.1` ✓. (Return store-credit path covered separately.)
- [x] 6.1c Tied to customer profile, **non-transferable** — **DONE + E2E TESTED** (`redeemVouchers` rejects a voucher whose `customerId` ≠ the bill's customer; generic vouchers stay open). E2E: `changes-new.spec.ts §6.1c` ✓ (checkout rejected with toast).
- [x] 6.2a Partial use, remaining balance on same code — **DONE + E2E TESTED**. `built-section6-11 §6.2a` ✓ (50k voucher on ~4k bill keeps remainder, stays active).
- [x] 6.2b Max 2 vouchers/bill — **DONE + E2E TESTED** (`MAX_VOUCHERS_PER_BILL=2` in `redeemVouchers()` + POS `addVoucher()` UI guard). E2E: `changes-new.spec.ts §6.2b` ✓ (3rd voucher blocked with toast). Const not yet Settings-wired (follow-up).
- [x] 6.2c Expiry 180 days — **DONE + E2E TESTED** (`DEFAULT_EXPIRY_DAYS=180` applied when expiry blank). E2E: `changes-new.spec.ts §6.2c` ✓ (created voucher expiry = +180d). Const not yet Settings-wired (follow-up).
- [x] 6.2d Validate expiry + balance before applying — **DONE + E2E TESTED**. `built-section6-11 §6.2d` ✓ (expired voucher rejected at POS).

## 7. Barcode Scanner Audio Feedback — **MEDIUM**
- [x] 7.1a Normal = 1 short high beep — **DONE + E2E TESTED** (Web-Audio spy: `[1320]`). `built-section1-7 §7.1` ✓.
- [x] 7.1b Duplicate = 2 quick beeps — **DONE + E2E TESTED** (spy: `[880,880]`). `built-section1-7 §7.1` ✓.
- [x] 7.1c Invalid = **3 long beeps** — **DONE + E2E TESTED** (spy: `[620,620,620]` — no ears needed). `built-section1-7 §7.1` ✓.
- [x] 7.1d Wired into POS scan handler — **DONE + E2E TESTED** (all 3 cues fire from real scans). `built-section1-7 §7.1` ✓.

## 8. End-of-Day Cash Reconciliation — **CRITICAL**
- [ ] 8.1 EOD workflow: reconcile drawer vs system (opening + closing balance) — **PARTIAL** (session open/close + expected calc exist `pos/service.ts:35-117`; no drawer-content breakdown).
- [ ] 8.2 Discrepancy reporting (variance + txn summary) — **PARTIAL** (variance `difference` computed; no transaction summary).
- [ ] 8.3 **[ADDED]** EOD fields: expected cash / petty cash (amt+reason) / cash drop (amt+time) / physical counted / net variance — **GAP** (petty cash, cash drop missing; physical count hardcoded to 0 in mobile-pos).
- [ ] 8.4 **[ADDED]** Shortfall rules: ≤₹50 auto-approve+log; >₹50 block close + Manager PIN + reason — **GAP** (no validation at all).

## 9. Commission & Incentive Adjustments — **MEDIUM**
- [~] 9.1 Auto-adjust salesman commission on return/exchange to net sale — **BUILT** (`commission-reconcile.ts`, triggered `sales/service.ts:605,889,1264`). Needs test.
- [ ] 9.2 Monthly statement: original → deductions → net — **PARTIAL** (commission list + report exist; **no original/deduction/net progression view**).

## 10. Business Performance Dashboard — **HIGH**
- [ ] 10.1 Overall summary: Total Sales, Cost, Profit, Avg Profit % — **GAP** (no COGS/profit/margin; dashboard shows revenue only).
- [ ] 10.2 Day-of-week performance + rating (Best/Strong/Good/Slow) — **GAP** (7-day chart exists; no DOW aggregation or ratings).
- [ ] 10.3 Monthly breakdown: Sales/Profit/Margin % + insights — **GAP** (no monthly grouping, margin %, or insights; "coming soon").
- [ ] 10.4 Predictive AI recommendations — **GAP** (no ML/forecasting).

## 11. Offline Mode Behaviour — **ADDED / NEW**
- [x] 11.1 Billing & checkout offline — **DONE + E2E TESTED**. `built-section6-11 §11` ✓ (offline checkout queued as OFF-).
- [x] 11.2 Barcode scanning offline (local product master) — **DONE + E2E TESTED**. `built-section6-11 §11` ✓ (scan resolves from local catalog offline).
- [ ] 11.3 Customer lookup read-only offline — **GAP** (no offline customer cache; live-only).
- [~] 11.4 Loyalty suspended / Cash works offline — **BUILT/by-decision** (loyalty ✓ skipped `pos/service.ts:301`, cash ✓). **DEVIATION from spec: Card/UPI stay ENABLED offline** (per owner 2026-06-30) — settlement happens out-of-band on the card machine / customer's UPI app, POS only records it, so there is no gateway call to fail offline. Do NOT add an offline-disable on Card/UPI. Needs test of loyalty-suspend + cash offline.
- [ ] 11.5 Offline bills 'pending sync' visible in Sales tab — **PARTIAL** (temp `OFF-…` numbers + sync badge; **no DB sync-status flag / Sales-tab visibility**).
- [ ] 11.6 On reconnect: auto-sync, permanent numbers, dedup, flag conflicts — **PARTIAL** (auto-sync ✓, dedup via `clientRef` ✓, numbering ✓; **conflict flagging GAP**).

## 12. Detailed Sales Transaction Breakup — **MEDIUM**
- [x] 12.1 Sales tab shows full price-modification breakdown — **DONE + E2E TESTED** (Bill Breakup card on sale-detail). `section12-breakup` ✓.
- [x] 12.2 Itemized deductions (Manual / Special / Loyalty pts / Voucher code) — **DONE + E2E TESTED** (persisted `manual/special/loyaltyDiscountAmount`; itemized on sale-detail). `section12-breakup` ✓.
- [x] 12.3 GST audit trail view (MRP→deductions→net→GST→paid) — **DONE + E2E TESTED** (CGST/SGST + Total Paid in Bill Breakup). `section12-breakup` ✓.

## 13. Inventory Management — **MEDIUM**
- [ ] 13.1 Margin config: whole-lot or per-line during inventory entry — **PARTIAL** (bulk-variant-generator has margin base; **no explicit margin % input / auto-price at import**).
- [ ] 13.2 Automated expense tracking: freight/delivery auto-captured under Expense — **GAP** (no freight fields on `InventoryMovement`; no auto-Expense creation).
- [x] 13.3 **[ADDED 2026-06-30]** Pricing & barcode — **DONE + E2E TESTED**: `Product.mrp` column; product form auto-fills Sale Price = round(MRP×0.9); MRP persists + flows to barcode `LabelData.mrp`; new `mrp` IR element type + default-template line + `resolveText`. `section13-pricing` ✓ (100→90, 999→899, persistence).
- [ ] 13.? ⚠️ **Doc truncated — re-check source for remaining 13.x / section 14+ items.**

---

## Roll-up

**Fully built, just needs testing → fastest wins:**
1.1, 1.3, 2.3, 4.1, 4.2, 6.1a, 6.1b, 6.2a, 6.2d, 7.1a, 7.1b, 7.1d, 9.1, 11.1, 11.2

**Quick targeted fixes (small, well-scoped):**
- 7.1c — invalid scan: make it 3 long beeps (1 file)
- 6.2b — cap 2 vouchers/bill · 6.2c — default 180-day expiry · 6.1c — voucher ownership check
- 1.2 — print returnable/exchange flags on receipt
- 11.4 — disable Card/UPI buttons when offline

**Medium effort:**
- 1.5 return policy windows · 5.3/5.5 add DOB+Gender+Birthday · 5.1/5.2 auto-new-customer prompt
- 8.1/8.2 EOD breakdown + discrepancy summary · 9.2 commission statement view
- 12.1/12.2/12.3 surface breakup in Sales tab · 13.1 margin % input

**Large / needs design decisions:**
- 1.4 VOID workflow (supervisor PIN) · 3.1–3.4 bill-edit in POS + partial-payment lock + PIN
- 2.1/2.2/2.4 payment-account settings · 4.3/4.4/4.5 hold soft-reserve + expiry + EOD report
- 5.6 AI Phase-1 size/category · 8.3/8.4 EOD petty-cash/cash-drop + shortfall + Manager PIN
- 10.1–10.4 profit/margin dashboard + insights · 11.3/11.5/11.6 offline customer cache + sync flags + conflict
- 13.2 freight auto-expense

**Cross-cutting prerequisite:** a **supervisor/manager PIN** approval mechanism recurs in 1.4, 3.4, 8.4 — worth building once, reused everywhere.

### Progress
**22 items E2E-tested + passing (`[x]`):** 1.1, 1.2, 1.3, 2.3, 4.1, 4.2, 6.1a, 6.1b, 6.1c, 6.2a, 6.2b, 6.2c, 6.2d, 7.1a-d, 11.1, 11.2, 12.1, 12.2, 12.3, 13.3 (+ 11.4 by decision).
Full E2E suite: **106 passing** (`npm run test:e2e`). Commits: `c7a622d`, `f709076`.
**Remaining (gap/partial):** 1.4, 1.5, 2.1, 2.2, 2.4, 2.5, 3.1, 3.4, 4.3, 4.4, 4.5, 5.1-5.6, 8.1-8.4, 9.1(test), 9.2, 10.1-10.3, 11.3, 11.5, 11.6, 13.1, 13.2. (5.7/10.4 = AI/ML, deferred.)
**Deploy:** DEFERRED to the end (owner decision 2026-06-30) — keep committing checkpoints; one production deploy when the whole list is done. Prod is a live store (manual SSH-tarball, root password not in repo).
**Decision logged:** 11.4 — Card/UPI stay enabled offline (no code change needed).
Follow-up: voucher cap (2) + expiry (180d) should later read from Settings (currently enforced constants).

### Running the E2E suite
Whole-system regression net (see `e2e/README.md`). Real UI + backend + Postgres; servers auto-boot;
a global setup tops up test-item stock so checkout tests are repeatable. Runs serial (one shared DB/session).
```
npm run test:e2e            # ENTIRE suite — 94 tests, all green (2026-06-30, 38.6s)
npm run test:e2e:system     # core subset: smoke-api + journeys + changes-new
```
Coverage: API smoke (every module), auth, dashboard, sales, customers, inventory, employees,
settings, offers/vendors/vouchers/expenses/accounting/reports/audit, POS checkout journey, and the quick-wins.
The old Angular-Material specs were rewritten against real Tailwind selectors (`demo`/`pos` removed).
**This box only:** headless Chromium needs `libasound.so.2`, which isn't installed and there's no sudo.
Workaround used (no root): extracted it from the `libasound2t64` .deb and ran with
`LD_LIBRARY_PATH=/tmp/libasound_local/extracted/usr/lib/x86_64-linux-gnu`.
Permanent fix on this machine: `sudo npx playwright install-deps chromium`.
NOTE: existing `e2e/*.spec.ts` (pos/sales/etc.) are STALE — written for Angular Material selectors this app doesn't use. `changes-new.spec.ts` uses the real Tailwind selectors.
