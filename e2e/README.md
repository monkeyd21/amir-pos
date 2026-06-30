# E2E regression suite

Whole-system safety net so new code that breaks an existing flow fails fast.
Real browser → real Angular → real Express → real Postgres.

## Run it

```bash
npm run test:e2e               # the whole suite (96 tests, all green @ 2026-06-30)
npm run test:e2e:system        # core subset: smoke-api + journeys + changes-new
```

`playwright.config.ts` auto-boots backend (3000) + frontend (4200) and reuses them
if already running. Postgres must be up with the dev DB seeded
(`admin@clothingerp.com` / `admin123`, seeded products with barcodes `200000000000x`).

## What's covered

| Spec | Layer | Covers |
|------|-------|--------|
| `smoke-api.spec.ts` | Backend | A safe read endpoint on **every** module returns `200 { success: true }`, plus an auth-rejection check. Catches 500s, broken contracts, removed routes. |
| `journeys.spec.ts` | Frontend | **Every authed route renders** (no /login bounce, no router crash) + the full **POS cash-checkout** journey with receipt. |
| `auth.spec.ts` | Frontend | Login form render, valid login, invalid-creds error, logout, protected-route guard. |
| `dashboard.spec.ts` | Frontend | Heading, KPI cards, analytics sections, sidebar navigation. |
| `sales.spec.ts` | Frontend | List heading/columns, filter toggle, open detail, return modal. |
| `customers.spec.ts` | Frontend | List heading/columns/search, open detail. |
| `inventory.spec.ts` | Frontend | Products list, Add-Product route, stock / transfers / import pages. |
| `employees.spec.ts` | Frontend | List heading/columns/search, attendance + commissions pages. |
| `settings.spec.ts` | Frontend | Heading + tabs (General/Branches/Users/Integrations), Add Branch. |
| `modules-extra.spec.ts` | Frontend | Offers, Vendors, Vouchers, Expenses, Accounting (ledger + P&L), Reports, Audit. |
| `changes-new.spec.ts` | Full | The "Changes NEW" quick-wins: receipt non-returnable flag (§1.2), 2-voucher cap (§6.2b), non-transferable voucher (§6.1c), 180-day expiry (§6.2c). |

**When you add a module/endpoint or a major screen, add a line to the relevant spec** so the net keeps pace.
`e2e/lib.ts` holds shared API-auth + POS helpers; `e2e/helpers.ts` holds `login(page)`.

## Keeping it green

- `smoke-api` asserts exact `200` — date-ranged reports/accounting endpoints need their
  query params (already encoded in the endpoint list). Baseline captured 2026-06-30, all green.
- The POS checkout journey needs an **open POS session** for the admin user (the seed/dev DB has one).

## History

The original `e2e/*.spec.ts` were written against **Angular Material selectors** (`mat-table`,
`mat-mdc-tab`, `mat-icon`) that this app never used (it's Tailwind), plus the old `demo.spec.ts`
and `pos.spec.ts`. Those were removed and rewritten against the real Tailwind selectors
(2026-06-30) — the whole suite is now green. Data-dependent steps (open a sale/customer detail,
return modal) are guarded so they pass on an empty DB.

## This machine only: missing libasound

Headless Chromium needs `libasound.so.2`, which isn't installed here and there's no sudo.
Permanent fix (do this once):

```bash
sudo npx playwright install-deps chromium
```

No-root workaround used during development (extract the lib from the .deb, then run with it on the path):

```bash
cd /tmp && mkdir -p libasound_local && cd libasound_local \
  && apt-get download libasound2t64 && dpkg-deb -x libasound2t64_*.deb extracted
LD_LIBRARY_PATH=/tmp/libasound_local/extracted/usr/lib/x86_64-linux-gnu \
  npm run test:e2e:system
```
