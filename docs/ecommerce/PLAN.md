# Sabiha's Ethnic — Online Store (`storefront`)

**Status:** Planning · no code written yet
**Owner:** Imran
**Created:** 2026-08-30
**Tracks:** the build of a public e-commerce website on the same database as the existing POS/ERP.

This is the living tracking document. Tick the boxes as work lands. The
companion `tech-spec.html` holds the detailed technical design; this file holds
*what we're doing, in what order, and what's still unknown*.

---

## 1. Decisions taken (2026-08-30)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Codebase topology | **New workspace in this monorepo** — `storefront/` + `backend/src/modules/shop/` | One Prisma schema, one migration history, one `deploy.sh`. The offers/loyalty/GST/checkout engines are imported directly instead of being reimplemented or proxied over HTTP. |
| D2 | Storefront stack | **Next.js (App Router) + React + Tailwind** | Retail discovery is organic search. Server-rendered product pages are indexable; an SPA effectively is not. Cost accepted: two frameworks in the house. |
| D3 | Stock model | **Live shared stock + cart reservation** | ~99% of articles are single-piece. Web and counter sell the same physical garment, so a soft-hold with expiry is the only model that doesn't either lie about stock or shrink the catalogue. |
| D4 | v1 scope | **Browse → pay online → ship** | Full transactional store. Click-and-collect and WhatsApp ordering are additive later, not v1 blockers. |

### Deliberately *not* in v1
Wishlist · product reviews · multi-currency · guest checkout without OTP ·
marketplace/multi-vendor · abandoned-cart automation · click-and-collect ·
subscription or loyalty-tier-gated pricing online.

---

## 2. The one hard problem

> Article #4821 is a single physical garment. It is visible on the website and
> on the POS at the same instant. Two people can want it in the same second.

Everything difficult about this project descends from that sentence. The full
mechanism is specified in `tech-spec.html` §4; the policy in one line:

**An in-store scan beats an unpaid web hold. A paid web order beats an in-store scan.**
Money settled wins. Unsettled intent loses.

Three concrete consequences that must be built, not assumed:

- **`topUpShortfall()` must be disabled for `channel: 'online'`.** Today
  `pos/service.ts` silently manufactures an `adjustment` stock-in when a scan
  exceeds on-hand, so a counter sale never dead-ends (`§ghost-inventory`). That
  is right for a cashier holding the garment and *wrong* for a web order — it
  would mint phantom stock for a piece already sold and ship nothing. Online
  checkout must fail loudly and auto-refund instead.
- **Availability is `inventory.quantity − active reservations`, never the raw
  quantity.** Any shop query reading `inventory.quantity` directly is a bug.
- **Reservations expire lazily** (`expiresAt > now()` in the availability
  query), so correctness never depends on a cron job firing on a 1 GB box.

---

## 3. What we reuse vs. what is new

Reuse is the whole point of D1. Concretely:

| Concern | Verdict | Note |
|---|---|---|
| Products / variants / price stack | **Reuse as-is** | `mrpOverride → priceOverride` resolution is already correct. Never read product-level price where a variant price exists. |
| Offers engine (`offers/engine.ts`) | **Reuse + extend** | Needs an `onlineEligible` flag so counter-only promos don't leak to the web. |
| Loyalty earn/redeem | **Reuse** | Redemption online requires an OTP-verified customer. |
| GST / `priceIncludesTax` | **Reuse** | Shipping-charge GST is an open question — see §7. |
| `Sale` / `SaleItem` | **Reuse** | `SaleChannel.online` already exists in the schema. |
| `posService.checkout()` | **Reuse, guarded** | Already accepts `channel` and `clientRef`. Needs: no `PosSession` requirement, no shortfall top-up, no commission, on the online path. |
| Cashfree gateway + webhook | **Reuse the driver, new intent flow** | `createUpiPayment()` hard-requires an open POS session; the web needs a session-free sibling. |
| `Return` model | **Reuse** | Reverse logistics is post-v1; v1 accepts in-store drop-off and by-post returns. |
| WhatsApp (Graph API) | **Reuse** | Doubles as the login OTP channel and the order-status notifier. |
| Bill numbering | **Reuse** | `BillSequence` already anticipates an `O-` online prefix. |
| Customer identity | **NEW** | `Customer` has no password and no auth of any kind today. |
| Addresses | **NEW** | `Customer.address` is a single free-text line. Shipping needs structured, multiple, validated addresses. |
| Cart + reservation | **NEW** | `HeldTransaction` is a counter park-a-sale, not a web cart, and holds no stock. |
| Order lifecycle | **NEW** | A `Sale` means *money taken, stock gone*. An order that is placed-but-unpaid is not a Sale. |
| Product images | **NEW — and the real bottleneck** | The schema has **zero** image fields anywhere. See §6. |
| Shipping / tracking | **NEW** | No carrier, no AWB, no serviceable-pincode concept exists. |

### The Order/Sale boundary (important)

`ShopOrder` owns the fulfilment lifecycle. The `Sale` row — the thing that hits
GST, reports, daily rollups and loyalty — is created **once, at payment
confirmation**, and never before. A cancelled unpaid order therefore leaves no
trace in the books, and the accounting side of the ERP needs no changes to stay
correct.

---

## 4. Build phases

### Phase 0 — Spec & design `IN PROGRESS`
- [x] Lock the four architectural decisions (D1–D4)
- [x] Audit the existing schema and checkout path for reuse and hazards
- [x] Write this tracking document
- [ ] Write `tech-spec.html`
- [ ] Produce the visual design canvas (storefront screens)
- [ ] Review + sign-off before any code is written

### Phase 1 — Data model & the image pipeline
- [ ] Migration: `ProductImage`, `Address`, `ShopCart`(+items), `StockReservation`, `ShopOrder`(+items), `Shipment`, `CustomerAuth`, `CustomerOtp`
- [ ] Migration: `Product.onlineVisible` / SEO content fields; `ProductVariant.onlineSellable`; `Offer.onlineEligible`
- [ ] Seed the system "Online Store" user + confirm which branch fulfils web orders
- [ ] Choose and wire object storage for images (Cloudflare R2 preferred — free egress)
- [ ] Bulk photo-upload tool in the ERP admin: scan barcode → shoot → upload → crop
- [ ] Backfill: decide the first ~100 SKUs to photograph and list

### Phase 2 — Shop API (`backend/src/modules/shop/`)
- [ ] Availability service — the single source of truth for "can this be sold online"
- [ ] Catalogue endpoints: list, filter, facets, search, single product
- [ ] Cart: create, add (reserve), update, remove (release), extend hold
- [ ] Reservation sweeper + lazy expiry in every availability read
- [ ] Unit tests covering the concurrency cases in tech-spec §4.6

### Phase 3 — Storefront skeleton
- [ ] Scaffold `storefront/` as an npm workspace (Next.js + Tailwind)
- [ ] Add it to root `package.json` scripts and `deploy/deploy.sh`
- [ ] Home, category/listing, product detail, cart — server-rendered
- [ ] Responsive pass (mobile is the majority of Indian retail traffic)

### Phase 4 — Customer identity
- [ ] Phone + OTP login over the existing WhatsApp integration
- [ ] Customer session tokens (separate from staff JWTs — different audience, different lifetime)
- [ ] Address book CRUD + pincode serviceability check
- [ ] Link a web signup to an existing `Customer` row by phone (do not duplicate the CRM record)

### Phase 5 — Checkout & payment
- [ ] Session-free online payment intent (Cashfree)
- [ ] Webhook → verify reservation still valid → create `Sale(channel: 'online')` → consume reservation
- [ ] Guard rails: no shortfall top-up, no POS session, no commission, `O-` bill prefix
- [ ] Auto-refund path when the piece vanished between payment and confirmation
- [ ] Order confirmation page + WhatsApp confirmation message

### Phase 6 — Fulfilment (ERP side)
- [ ] Orders screen in the Angular admin: new → packed → shipped → delivered
- [ ] Pick list / packing slip print (reuse the `printing` module)
- [ ] Carrier integration or manual AWB entry + tracking link
- [ ] Order-status notifications over WhatsApp

### Phase 7 — POS integration
- [ ] Cashier warning when scanning a barcode with a live web hold
- [ ] Verify `closeSession` cash-expectation math excludes online sales entirely
- [ ] Verify online sales don't distort commission, daily rollups, or drawer variance
- [ ] End-to-end race test: web hold vs. counter scan, both orderings

### Phase 8 — Launch
- [ ] SEO: sitemap, robots, canonical URLs, Open Graph, `schema.org/Product`
- [ ] `shop.sabihasethnic.com` (or apex) DNS + TLS + nginx vhost
- [ ] Analytics + basic conversion funnel
- [ ] Legal pages: returns, shipping, privacy, T&C
- [ ] Load-sanity check on the 1 GB Oracle box; decide if the storefront needs its own host

### Phase 9 — Post-launch backlog
- [ ] Online returns with reverse pickup
- [ ] Wishlist, reviews, recently-viewed
- [ ] Abandoned-cart WhatsApp nudge
- [ ] Click & collect
- [ ] "Order on WhatsApp" fallback button

---

## 5. Infrastructure reality check

The whole ERP currently runs on **one free Oracle ARM VM**, Node capped at a
1 GB heap, nginx → `:3000`, Angular served out of `backend/public`.

Adding a public, image-heavy, search-engine-crawled Next.js app to that box is
the main operational risk in this project. Positions to decide in Phase 3:

- **Images must not be served from the box.** Object storage + CDN, always.
- Next.js runs as a **second systemd service** on `:3001`; nginx routes by
  hostname. It does *not* get merged into the Express process.
- Expect to move the storefront (or the whole stack) to a paid host once real
  traffic and crawlers arrive. Budget for it rather than discovering it.

---

## 6. The actual bottleneck: photography

There are no images in the database. Not a missing column — the concept does
not exist in the schema. For a clothing store where ~99% of stock is a single
unique piece, **every SKU needs its own photographs**; there is no shared
catalogue shot to fall back on.

This is a content operation, not an engineering one, and it will outlast the
code. It needs a decision before Phase 1 closes:

- Who shoots? In-house on a phone, or a photographer?
- How many angles per piece? (3 is the realistic minimum: front, detail, fabric)
- What is the per-piece turnaround, and does it gate listing new arrivals?
- Do we launch with a curated ~100 pieces rather than the full catalogue?

**Recommendation:** launch curated. A hundred well-shot pieces convert; three
thousand grey placeholders do not.

---

## 7. Open questions

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | Which branch fulfils web orders — a real store, or a dedicated online branch row? | Phase 1 | OPEN |
| Q2 | Shipping charges: flat, weight-based, or free above a threshold? And GST treatment of the shipping line (composite supply)? | Phase 5 | OPEN |
| Q3 | Courier — Delhivery/Shiprocket integration, or manual AWB entry in v1? | Phase 6 | OPEN |
| Q4 | Hold duration. 15 min is the proposed default; too short frustrates, too long hides stock from the counter. | Phase 2 | PROPOSED: 15 min cart / 20 min at checkout |
| Q5 | Do online sales earn staff commission? Proposal: no. | Phase 5 | PROPOSED: no |
| Q6 | Can loyalty points be redeemed online in v1? Proposal: yes, OTP-verified only. | Phase 5 | PROPOSED: yes |
| Q7 | Domain: `shop.sabihasethnic.com` or the apex, with the ERP staying on `erp.`? | Phase 8 | OPEN |
| Q8 | Return window and who pays return shipping? | Phase 9 | OPEN |
| Q9 | Photography ownership and cadence (see §6). | Phase 1 | OPEN |

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Overselling a single-piece garment | Refunds, bad reviews, chargebacks | Reservation model (§2); paid-beats-unpaid rule; auto-refund path |
| `topUpShortfall` reached from the web path | Phantom stock, orders that can never ship | Explicit guard + a regression test that fails if the guard is removed |
| Photography never happens | The site launches empty and stays empty | Treat as a tracked workstream with an owner, not a side task |
| 1 GB box under crawler + shopper load | Site down, POS down *with it* | Images off-box; separate service; migration budget agreed in advance |
| Two frameworks to maintain | Slower iteration, context switching | Keep shared logic in `backend`/`shared`; the storefront stays a thin view layer |
| One repo = one blast radius | A shop bug takes down the till | Shop code confined to its own module; POS paths untouched except where explicitly listed |
| Migration drift against a live production DB | Data loss on a running shop | Same discipline already used for payroll: reviewed SQL in `deploy/sql/` |

---

## 9. Changelog

| Date | Entry |
|---|---|
| 2026-08-30 | Document created. D1–D4 decided. Schema audited; `SaleChannel.online`, `clientRef` idempotency and `BillSequence` online-prefix support found already present. `topUpShortfall` identified as the primary hazard. Zero image fields confirmed. |
