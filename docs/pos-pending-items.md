# POS — Pending Items

Remaining items from the client requirements doc, after the overhaul + fix
batches shipped to prod. In priority order. (See `pos-overhaul-log.md` for
what's already done.)

## Already done (don't re-do)
- ✅ Exchange credit ignored discounts — now uses `SaleItem.total ÷ quantity`.
- ✅ Loyalty config not saving (`minRedeemPoints` was stripped by the validator).
- ✅ Loyalty min-balance retention — only the excess above `minRedeemPoints` is redeemable.
- ✅ Payment-before-discount UI — tenders re-fit to the current bill (`reclampTenders()`).
- ✅ Refund proportional to original tenders + loyalty restore (the ₹2,780 scenario).
- ✅ GST incl/excl dropdown and sidebar scroll were already implemented (no work).

## Still pending

### Reported bugs / clear features (do next)
1. **EOD cash reconciliation UI** — backend `closeSession` already computes
   `expectedAmount` (opening + cash sales − cash refunds). Needs a frontend
   session-close screen: count cash → expected vs counted → variance.
   NOTE: cash refunds from `processReturn` are **not** recorded as `refunded`
   Payment rows (edit-refunds in `editSale` ARE), so the drawer expectation can
   be off for return-heavy days — fix by mirroring the refunded-Payment-row
   logic into `processReturn`.

### Smaller features
2. **Favorite-size memory + birthday / last-visit in customer search** — needs a
   `Customer.birthday` field (migration) + aggregate most-purchased size from
   sale history; surface in the POS customer panel + smart search.
3. **Add-vendor button** — vendors module exists; a create button is missing
   where the user expected it.
4. **Existing-product-name autocomplete** when adding inventory.
5. **Non-returnable enforcement in EXCHANGE paths** — enforced on refund-returns
   (`processReturn`) but NOT in `processExchange` / the POS inline exchange.
   Block `nonReturnable` goods there too (load `variant.product` flags + per-line
   `SaleItem.nonReturnable`; `exchangeOnly` is still allowed in an exchange).

### Offline follow-ups (Batch 4 boundaries)
6. **Offline NEW-customer creation** and **offline returns** — today an offline
   bill attaches an existing cached customer or none.
7. **Service-worker runtime verification** — implemented + deployed
   (`ngsw-worker.js` live), but never browser-verified (the dev WSL lacks the
   GUI libs for headless Chromium). Confirm cold-offline reload works on prod.
