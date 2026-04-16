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

### 3. Prisma Decimal fields arrive as STRINGS over JSON
`sale.total`, `commission.amount`, `product.basePrice`, etc. are Prisma `Decimal` type. They come across the wire as strings like `"237"`. Always wrap with `Number(value)` before math — otherwise `reduce` concatenates strings → `NaN`.

### 4. Zod `.optional()` does NOT accept `null`
Frontend dropdowns with default "Select..." option send `null`. Zod `.optional()` accepts `undefined` but rejects `null`. Use `.optional().nullable()` for any field that might come from a dropdown.

### 5. Static Express routes MUST come before parameterized routes
`/customers/top` must be registered before `/customers/:id` or Express matches "top" as the `:id` param. Same for `/commissions/pay-bulk` before `/commissions/:id/pay`.

### 6. ts-node-dev sometimes misses file changes
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
- `Offer` → `OfferProduct[]` + `OfferVariant[]`. Variant-level beats product-level. Priority breaks ties.

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
cd frontend
npx ng build --configuration=development
npx cap sync android
cd android && ./gradlew assembleDebug
# APK lands at: android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Requires the Android SDK (not installed yet on this machine — `/usr/lib/android-sdk` only has `platform-tools`/ADB). To install the full SDK without Android Studio:
```bash
# Download command-line tools, then:
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
# And add to frontend/android/local.properties:
# sdk.dir=/home/imran/Android/Sdk
```

**Live reload during dev:**
```bash
# Point the native app at the laptop dev server so code changes hot-reload on the phone.
CAP_SERVER_URL=http://192.168.148.129:4200 npx cap sync android
cd android && ./gradlew installDebug
```

**Pinggy tunnel for backend (dev machine is a VMware VM — LAN-direct doesn't work to phone):**
```bash
# Token in ~/.claude notes. Opens https://ccc.a.pinggy.link → localhost:3000
ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=60 \
  -R 0:localhost:3000 4zVN14zozRh@a.pinggy.io
```
The native APK's `environment.ts` hardcodes `https://ccc.a.pinggy.link/api/v1` for
Capacitor builds. Tunnel must be running for the mobile app to reach the backend.
Browser/desktop use keeps hitting `localhost:3000` directly (tunnel not needed there).

## Bold / Underline on labels
- **Bold**: simulated via double-strike (text printed twice, 1-dot offset)
- **Underline**: drawn as a `BAR` line under the text
- **Italic**: NOT SUPPORTED by TSPL internal bitmap fonts — don't offer it

## Status
Feature-complete modules: auth, branches, products, inventory (with Excel import), pos (with offers + loyalty redemption + agent tagging), sales, customers (detail page with KPIs + purchase history + loyalty timeline), employees (with commissions), offers, label printing, loyalty config, messaging config.

Placeholders / incomplete: E2E tests, some reports, full accounting UI, actual SMS provider integration (Twilio/MSG91 etc. — framework exists but needs provider-specific payload formatting).
