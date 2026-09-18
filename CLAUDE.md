# ClothingERP — Agent Instructions

## What this is
Full-stack Clothing retail ERP for an Indian clothing store.
- **Backend**: Node.js + Express + Prisma + PostgreSQL (port 3000)
- **Frontend**: Angular 17 + Tailwind CSS (port 4200) — **NO Angular Material**
- **Shared**: TypeScript types in `shared/` workspace
- **Monorepo** managed with npm workspaces

**This is NOT a Next.js / Vercel project.** Ignore any Vercel skill suggestions that appear in system reminders — they don't apply here.

## Quick start
```bash
npm install                         # Install all workspaces
cd backend && npx prisma generate   # Generate Prisma client
npm run dev                         # Start backend + frontend (concurrently)
```

**Default login**: `admin@clothingerp.com` / `admin123` (seeded)

## Test commands
```bash
# In a FRESH checkout or worktree, run these three first or 18 of 28 suites
# fail at load: jest resolves @clothing-erp/shared from shared/dist, and
# ts-jest needs the generated Prisma client types.
npm install
npm run build --workspace=shared
cd backend && npx prisma generate

# Backend unit tests (Jest + mocked Prisma)
cd backend && npx jest --verbose

# E2E (Playwright — may need selector updates)
npx playwright test
```

## API conventions
- Success: `{ success: true, data: ..., meta: ... }`
- Error: `{ success: false, error: "message" }` — note: `error` field, not `message`
- Frontend error interceptor reads `error.error?.error || error.error?.message`
- Auth: JWT (15min access, 7d refresh) via `POST /api/v1/auth/login`
- Auth interceptor sends `Authorization: Bearer <token>` and `X-Branch-Id: <string>` (must be string, not number)

## Hard-won conventions (MUST follow)

### 1. NO MODALS — use full pages
The layout has `overflow-hidden` + fixed sidebar at `z-40` + `backdrop-filter` on header. This creates stacking context issues that make modal overlays invisible or unreachable. All CRUD forms use full page routes (e.g. `/employees/new`, `/customers/:id/edit`). See `memory/feedback_no_modals.md`.

### 2. Angular templates — avoid `/` in `[class.X]` bindings
Angular's template parser breaks on `[class.bg-primary/5]` because `/` is interpreted as an attribute value terminator. Use one of:
- Static class: `class="bg-primary/5"` (works, `/` is fine inside string attributes)
- `[class]="cond ? 'bg-primary/5 text-white' : 'bg-gray-200'"` (full class string binding)
- Separate non-slash fallback: `[class.bg-blue-50]="cond"`

### 3. The POS charges the SALE PRICE, not the MRP
Scanning an article prices the line at the stored Sale Price
(`variant.priceOverride ?? product.basePrice`), resolved by
`nonClearanceChargePrice()` in `pos/service.ts`. It used to charge the MRP,
which forced the cashier to key a discount on every line. The MRP still travels
on the cart line and is snapshotted onto `SaleItem.mrp` so the receipt prints it
struck through as the "was" price — it just no longer decides what is charged.
Clearance lines are separate again: they charge the fixed `clearancePrice`.

Since `7066a04` every variant owns a materialised price stack
(`mrpOverride` / `priceOverride` / `costOverride` / `landingOverride`), and the
product-level `mrp` / `basePrice` is only a creation-time template. **Never read
the product price where a variant price exists** — that was the clearance-MRP
bug.

The tag/MRP rule is `pos/tag-mrp.ts` (`tagMrp` / `snapshotMrp`), used by the scan
lookup and the checkout snapshot. It stops at `product.mrp`: `basePrice` is a
Sale Price template and must never be read as a tag price, or the bill invents a
saving the shelf never carried.

### 3a. The bill reads MRP-first
Every bill surface shows the MRP total as its subtotal and the markdown down to
the charged Sale Price as its own "Price saving" row, so
`subtotal − price saving − discounts = total`. Display only: `Sale.subtotal`
stays the charged gross. The row is hidden at zero, and each line's MRP is
floored at its charged price so the saving can never go negative. Not to be
confused with "You Saved", which measures the whole way down to the bill total.
Arithmetic lives in `sales/receipt-pdf.ts` (`computeMrpTotals`, tested), mirrored
in `pos-terminal.component.ts`, `receipt-print.service.ts` and
`mobile-cart.service.ts`.

### 4. Clearance is "exchange freely, refund on the Owner PIN"
A clearance line sets `SaleItem.nonReturnable` at checkout, but that flag no
longer means "never". The rules live in `shared/src/exchange-policy.ts`, in the
SHARED workspace, not the backend, because the server gate and the UI pickers
must apply the same test. `backend/src/modules/pos/exchange-policy.ts` is a
re-export shim so existing backend imports keep working, and the frontend
imports the same functions from `@clothing-erp/shared`:

- `canExchangeLine` — anyone may swap a clearance line, no authorisation.
- `refundRule` — a clearance line returns `'owner-pin'`: refundable, but only
  once a Manager or Owner enters the Owner PIN (§6.4, `services/owner-pin.ts`).
  A cashier-flagged line and a `nonReturnable` PRODUCT return `'never'` — those
  are about the goods, not the price paid, and no PIN reaches them. Order
  matters: clearance is checked BEFORE the line flag, because clearance is what
  sets that flag.
- `clearanceCashOutBlocked` — an exchange that hands money back is a clearance
  refund in a swap's clothing, so it takes the same PIN (`pos/service.ts`);
  otherwise the replacement must be worth at least the clearance credit.

**Never hand-roll `!item.nonReturnable` in a picker.** That filter hid every
clearance line from the Sales-tab refund list and then, separately, from the POS
exchange list (bill W0215). The goods were returnable, the server would have
accepted them, the cashier simply could not see them. The POS exchange picker is
now `frontend/src/app/modules/pos/exchange-items.ts` (`buildExchangeItems`,
tested in `exchange-items.spec.ts`); `sale-detail.component.ts` exposes
`returnableItems` (refund, via `refundRule`) and `exchangeableItems` (swap, via
`canExchangeLine`) as two separate lists, because they are two different
questions.

The policy module never checks the PIN itself — the service does, so policy
stays testable without a database. Both PIN-spending sites write a
`refund.clearance_authorised` audit row where the PIN is SPENT. The row names
the cashier who rang it up, never the approver: the Owner PIN is one shared
secret, so it proves somebody senior agreed and cannot say who (`Return.approvedBy`
stays null for that reason — copy `services/exchange-override.ts` if a name is
ever needed).

The bill deliberately still prints `** NON-RETURNABLE` on clearance lines, and
"NON-RETURNABLE items cannot be returned or exchanged" below them, on BOTH
surfaces (`sales/receipt-pdf.ts` and `receipt-print.service.ts`). That is the
shop's position with the customer; the PIN is the exception it keeps the right
to make. Do not "fix" the receipt to advertise the swap — the PDF used to say
"NOT RETURNABLE - EXCHANGE ONLY" and contradicted the thermal bill.

### 4a. One exchange per bill is a BILL-level guard, layered on top
`pos/exchange-limit.ts` answers a different question from `exchange-policy.ts`:
not "may this line come back" but "has this receipt already been swapped once".
`Return.type` is the only thing that separates the two cases, so a bill that was
merely REFUNDED against still has its exchange. Both exchange entry points check
it inside their own transaction (`pos/service.ts` checkout with an `exchange`
block, and `sales/service.ts` `processExchange`), and `GET /sales/:id` carries a
derived `priorExchange` so the UI can warn before the cashier picks anything.

The policy warns, it does not block: a manager or owner authorises a second swap
with their OWN credentials via `POST /sales/:saleId/exchange-override`, which
returns a short-lived signed grant scoped to that one bill. The grant, never the
password, rides on the exchange submission. Credentials rather than the shared
Owner PIN (§2.3, §8.2) because the PIN cannot say WHO approved. The audit row
(`exchange.limit_overridden`) and `Return.approvedBy` are written where the
grant is SPENT, so the log never claims an approval that was never used.

An exchange also carries the original bill's customer onto the replacement sale
(`carriedCustomerId`); an explicitly chosen customer wins, and a walk-in
original carries nobody.

### 4b. Several offers on one article: best at the CURRENT quantity wins
`offers/engine.ts` → `chooseBestOffer` is the only place that answers "which
offer does this line get", and it answers it fresh on every evaluation, because
the answer changes with the quantity. The order is:

1. **Scope targets, it does not rank money.** A variant-level assignment is the
   shop singling that article out, so variant-level offers are considered first
   — but only those that actually APPLY at this quantity. If none do, product-
   level offers get their turn instead of the line losing every discount.
2. **Within the winning scope, the biggest discount for the customer wins.**
3. **Priority (then recency, then id) breaks genuine ties only.**

So "Rs 50 off" holds a line at 1 and 2 units and "3 for Rs 1200" takes it over
at 3, whichever of the two carries the higher priority — and it hands back if
the third unit is removed. The old code picked ONE offer per line by priority
BEFORE looking at quantity, so a bundle that lost the priority tie at qty 1 was
never reconsidered at qty 3 and the shop never charged the bundle price.

One line still takes exactly ONE offer — `SaleItem.offerId` records the single
deal given, so offers never stack on a line. When a line already qualifies but a
richer deal is a unit or two away, `evaluateCart` returns `upcomingHint`
alongside (`hint` still means "this offer does not apply yet"); the terminal
prints it under the offer text as an upsell.

`evaluateCart` feeds checkout, `POST /pos/cart/evaluate` and the storefront
quote, so all three agree by construction. Tests: `offers/__tests__/offer-choice.test.ts`.

### 4c. A BUNDLE is priced over the basket, not the line
"3 for Rs. 1200" means any three pieces the offer covers: three sizes, three
colours, three different articles. Every other offer type is a property of one
line, but the cart splits a basket by variant (`pos-terminal` merges scans on
`variantId`), so three sizes arrive as three lines of one. Asked line by line,
the deal never fired — and on a rail carrying one piece per size it never could.

`poolBundle` (pure, tested) prices a bundle over every line the offer covers and
apportions the discount BACK onto those lines by the value each put in. That
split is not cosmetic: `SaleItem.offerId` and `effectiveUnitPrice` are per line
and a refund pays `SaleItem.total ÷ quantity`, so a customer returning one piece
of a three-for-1200 gets its share of the deal, never a third of the shelf price.

Rules worth knowing before touching it:
- The **dearest** units go into the bundle, so four pieces pay 1200 for the top
  three and shelf price for the cheapest. Largest saving, and the only split a
  customer would not argue with.
- A bundle takes the lines only when the pool beats what those lines already
  had, so it never costs the customer a better deal they were already getting.
- A bundle consumes UNITS but an offer is recorded per LINE, so a line can be
  straddled. Units left outside the deal keep the offer they would have had on
  their own; otherwise a 2+2+1 basket costs more than a 2+1+2 one for the same
  five pieces. The line still records the bundle as its offer, and
  `effectiveUnitPrice` is the line's average.
- A bundle priced above the shelf value of the pieces it covers is not applied.
- Clearance lines are kept OUT of the engine's input entirely (`pos/service.ts`),
  not filtered out of its answer: a clearance line left in would swell the pool
  and change what the other lines are charged.

Tests: `offers/__tests__/pooled-bundle.test.ts` (arithmetic and the split) and
`pooled-bundle-cart.test.ts` (which offer a line ends up with).

### 5. Prisma Decimal fields arrive as STRINGS over JSON
`sale.total`, `commission.amount`, `product.basePrice`, etc. are Prisma `Decimal` type. They come across the wire as strings like `"237"`. Always wrap with `Number(value)` before math — otherwise `reduce` concatenates strings → `NaN`.

### 6. Zod `.optional()` does NOT accept `null`
Frontend dropdowns with default "Select..." option send `null`. Zod `.optional()` accepts `undefined` but rejects `null`. Use `.optional().nullable()` for any field that might come from a dropdown.

### 7. Static Express routes MUST come before parameterized routes
`/customers/top` must be registered before `/customers/:id` or Express matches "top" as the `:id` param. Same for `/commissions/pay-bulk` before `/commissions/:id/pay`.

### 8. ts-node-dev sometimes misses file changes
If you edit a file and don't see `[INFO] Restarting` in the backend log, force a restart. The `--respawn` flag isn't perfectly reliable. `touch` doesn't always work; you may need to modify file content (add/remove a blank line).

## Field mapping gotchas
When rendering sale items / inventory in the frontend:
- `item.variant.product.name` (not `item.productName`)
- `item.variant.size` / `item.variant.color`
- `sale.user.firstName + ' ' + sale.user.lastName` (cashier)
- `item.agent.firstName + ' ' + item.agent.lastName` (per-line salesman)
- `sale.customer.firstName + ' ' + sale.customer.lastName`
- `commission.user` (not `commission.employee`)

Always use fallback: `item.variant?.product?.name || item.productName || item.name`

## Module map

### Backend modules (`backend/src/modules/*`)
| Module | Purpose | Notable routes |
|---|---|---|
| `auth` | JWT login/refresh | `POST /login` |
| `branches` | Multi-branch config | CRUD |
| `users` / `employees` | Staff management | `GET/POST/PUT /employees`, commission calc, attendance |
| `products` | Products + variants | CRUD, variant management |
| `inventory` | Stock levels, transfers, **import** | `/inventory/import/{template,preview,execute}` for Excel upload |
| `barcodes` | Barcode lookup/generation | Not the same as label printing |
| `printing` | Label designer + template engine | `/printing/printers`, `/printing/templates`, TSPL/ZPL/EPL2/ESC-POS/PDF drivers |
| `pos` | Checkout, cart, sessions | `/pos/checkout`, `/pos/cart/evaluate` (offer resolution) |
| `sales` | Sales history, returns, agent assignment | `PUT /sales/:saleId/agents` for retroactive agent tagging |
| `offers` | Discount engine | 5 types: percentage/flat/bogo_free/bogo_percent/bundle |
| `customers` | Customer CRM + loyalty | `GET /customers/top` for repeat tracking |
| `loyalty` | Points earn/redeem/config | `GET/PUT /loyalty/config` |
| `messaging` | WhatsApp (real, Graph API) + SMS (stub, pluggable) | `/messaging/send-bill`, `/messaging/send-custom` |
| `settings` | Global key/value settings | `commissionMode`, `messagingConfig`, etc. Label templates moved to `printing` module. |
| `expenses` | Expense tracking | CRUD + categories |
| `accounting` | Journal entries | Basic double-entry |
| `reports` | Analytics + CSV export | Sales, inventory, commissions, P&L |
| `payments` | UPI/card gateway | Webhook at `/api/v1/webhooks/payment` (raw body) |

### Frontend modules (`frontend/src/app/modules/*`)
`auth`, `dashboard`, `sales`, `inventory`, `pos`, `customers`, `employees`, `expenses`, `accounting`, `reports`, `offers`, `settings`

## Key data models
- `Sale` has `userId` (cashier). `SaleItem` has `agentId` (per-line salesman — independent of cashier).
- `Commission.userId` = agent/cashier who earned it. Rate comes from `User.commissionRate`.
- `Customer` has `loyaltyPoints`, `loyaltyTier` (bronze/silver/gold/platinum), `totalSpent`, `visitCount` (auto-incremented on sale).
- `SaleItem.offerId` + `effectiveUnitPrice` — stored at checkout for fair BOGO refunds.
- `Offer` → `OfferProduct[]` + `OfferVariant[]`. Variant-level beats product-level, then the
  best deal at the line's current quantity wins and priority breaks ties (§4b). The offer detail
  page shows the saved coverage in its own "Articles Covered" panel, read from these two relations
  rather than from the paged product picker below it.

## Global settings (in `Setting` table)
- `labelTemplate` — DEPRECATED, moved to `label_templates` table per-printer in the `printing` module
- `commissionMode` — `'item_level'` (default) or `'bill_level'`
- `messagingConfig` — `{ whatsappEnabled, whatsappPhoneNumberId, whatsappAccessToken, smsEnabled, smsProvider, smsApiKey, smsSenderId }` (tokens masked on GET)

## Local printer setup (done once)
The Zenpert 4T520 thermal printer is installed as a raw CUPS queue:
- Device: `/dev/usb/lp0` (udev rule gives `plugdev` group write access)
- Label templates are per-printer-profile, managed at `/settings/printers`
- Drivers: TSPL (default for Zenpert/TSC), ZPL, EPL2, ESC-POS, PDF

## Current hardware
- Zenpert 4T520 thermal label printer (TSC OEM, USB VID 1203:12a1) — 50×75mm labels loaded
- Uses TSPL (not ZPL). ₹ symbol doesn't render in internal fonts — use "Rs." prefix.

## Mobile POS (Android, Capacitor)
Native Android app wraps the same Angular frontend. Route: `/mobile-pos` (full-screen, no sidebar). Uses `@capacitor-mlkit/barcode-scanning` for fast ML Kit barcode scanning via the phone camera.

- Config: `frontend/capacitor.config.ts` (appId `com.clothingerp.pos`, webDir `dist/frontend/browser`)
- Android project: `frontend/android/` (scaffolded with `npx cap add android`)
- API URL: auto-resolves from `window.location.hostname` — so if phone opens `http://192.168.x.x:4200/mobile-pos`, API calls go to `http://192.168.x.x:3000/api/v1`. Laptop dev at `localhost` stays on `localhost:3000`.
- Camera permission in `AndroidManifest.xml` (`android.permission.CAMERA` + camera feature optional).

**Test in browser first (fastest):**
```bash
# On phone, open:  http://<laptop-LAN-IP>:4200/mobile-pos
# Scanner falls back to a prompt() in browser — no camera — but cart/checkout flow all works.
```

**Build native APK:**
```bash
./deploy/build-apk.sh            # debug  -> dist-apk/amir-pos-debug.apk
./deploy/build-apk.sh --release  # unsigned release
adb install -r dist-apk/amir-pos-debug.apk
```

The Android SDK **is now installed** at `~/Android/Sdk` (cmdline-tools +
platform-tools + `platforms;android-36` + `build-tools;36.0.0`, ~462 MB) and
`frontend/android/local.properties` is written by the build script. Java 21 and
Gradle 8.14.3 / AGP 8.13 are what the project expects.

**The APK talks to `https://erp.sabihasethnic.com/api/v1`** — the real prod
domain with a real certificate. No Pinggy tunnel and no laptop are involved.
The host is resolved in `frontend/src/environments/api-url.ts`, which is a
separate module on purpose: a production build REPLACES `environment.ts` with
`environment.prod.ts` (`angular.json` → `fileReplacements`), so a prod file
importing `./environment` would import itself.

Previously this pointed at `https://amir-pos.up.railway.app`, a Railway
deployment that never existed — an APK built before that fix could not reach a
backend at all.

**Live reload during dev** (optional, points the native app at the dev server):
```bash
CAP_SERVER_URL=http://192.168.148.129:4200 npx cap sync android
cd frontend/android && ./gradlew installDebug
```

## Bold / Underline on labels
- **Bold**: simulated via double-strike (text printed twice, 1-dot offset)
- **Underline**: drawn as a `BAR` line under the text
- **Italic**: NOT SUPPORTED by TSPL internal bitmap fonts — don't offer it

## Status
Feature-complete modules: auth, branches, products, inventory (with Excel import), pos (with offers + loyalty redemption + agent tagging), sales, customers (detail page with KPIs + purchase history + loyalty timeline), employees (with commissions), offers, label printing, loyalty config, messaging config.

Placeholders / incomplete: E2E tests, some reports, full accounting UI, actual SMS provider integration (Twilio/MSG91 etc. — framework exists but needs provider-specific payload formatting).
